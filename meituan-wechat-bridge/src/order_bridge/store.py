import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .models import BridgeConfig, OrderEvent, Route, format_message

STATES = {
    "pending",
    "leased",
    "sending",
    "retry",
    "sent",
    "simulated",
    "dead",
    "uncertain",
    "suppressed",
}


class Conflict(ValueError):
    """The requested queue transition is no longer valid."""


class Store:
    def __init__(self, data_dir: Path, config: BridgeConfig):
        data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = data_dir / "bridge.sqlite3"
        self.config = config
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS routes (
                    store_id TEXT PRIMARY KEY, route TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    store_id TEXT NOT NULL, order_id TEXT NOT NULL, event TEXT NOT NULL,
                    payload TEXT NOT NULL, target TEXT NOT NULL, message TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                    worker_id TEXT, mode TEXT, lease_token TEXT, lease_until REAL,
                    next_attempt REAL NOT NULL DEFAULT 0,
                    last_error TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    UNIQUE(store_id, order_id, event)
                );
                CREATE INDEX IF NOT EXISTS queue_due ON jobs(state, next_attempt, id);
                CREATE TABLE IF NOT EXISTS workers (
                    worker_id TEXT PRIMARY KEY, mode TEXT NOT NULL, last_seen REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id INTEGER NOT NULL, state TEXT NOT NULL,
                    note TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS job_event_history ON job_events(job_id, id);
            """)
            for store_id, route in config.routes.items():
                db.execute(
                    "INSERT OR IGNORE INTO routes VALUES (?, ?)",
                    (store_id, route.model_dump_json()),
                )
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def public_job(row) -> dict:
        result = dict(row)
        result.pop("lease_token", None)
        result["target"] = json.loads(result["target"])
        result["payload"] = json.loads(result["payload"])
        return result

    def routes(self) -> dict:
        with self.connect() as db:
            return {
                r["store_id"]: json.loads(r["route"])
                for r in db.execute("SELECT * FROM routes ORDER BY store_id")
            }

    def set_route(self, store_id: str, route: Route):
        with self.connect() as db:
            db.execute(
                "INSERT INTO routes VALUES (?, ?) ON CONFLICT(store_id) "
                "DO UPDATE SET route=excluded.route",
                (store_id, route.model_dump_json()),
            )

    @staticmethod
    def _record(db, job_id: int, state: str, note: str, now: float):
        db.execute(
            "INSERT INTO job_events(job_id,state,note,created_at) VALUES (?,?,?,?)",
            (job_id, state, note[:1000], now),
        )

    def ingest(self, order: OrderEvent) -> tuple[dict, bool]:
        message = format_message(order)
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM jobs WHERE store_id=? AND order_id=? AND event=?",
                (order.store_id, order.order_id, order.status),
            ).fetchone()
            if existing:
                return self.public_job(existing), False
            route_row = db.execute(
                "SELECT route FROM routes WHERE store_id=?", (order.store_id,)
            ).fetchone()
            if not route_row:
                raise ValueError("unknown store; configure its destination before ingesting orders")
            original = db.execute(
                "SELECT target FROM jobs WHERE store_id=? AND order_id=? ORDER BY id LIMIT 1",
                (order.store_id, order.order_id),
            ).fetchone()
            target = original["target"] if original else route_row["route"]
            state = "pending"
            if order.status == "cancelled":
                # A cancellation supersedes even an acquired but not yet started notification.
                stopped = db.execute(
                    "SELECT id FROM jobs WHERE store_id=? AND order_id=? AND event='confirmed' "
                    "AND state IN ('pending','retry','leased')",
                    (order.store_id, order.order_id),
                ).fetchall()
                db.execute(
                    "UPDATE jobs SET state='suppressed', lease_token=NULL, lease_until=NULL, "
                    "updated_at=? WHERE store_id=? AND order_id=? AND event='confirmed' "
                    "AND state IN ('pending', 'retry', 'leased')",
                    (now, order.store_id, order.order_id),
                )
                for stopped_job in stopped:
                    self._record(db, stopped_job["id"], "suppressed", "订单取消，停止接单通知", now)
            elif db.execute(
                "SELECT 1 FROM jobs WHERE store_id=? AND order_id=? AND event='cancelled'",
                (order.store_id, order.order_id),
            ).fetchone():
                state = "suppressed"
            cursor = db.execute(
                "INSERT INTO jobs(store_id,order_id,event,payload,target,message,state,"
                "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    order.store_id,
                    order.order_id,
                    order.status,
                    order.model_dump_json(),
                    target,
                    message,
                    state,
                    now,
                    now,
                ),
            )
            row = db.execute("SELECT * FROM jobs WHERE id=?", (cursor.lastrowid,)).fetchone()
            self._record(
                db, row["id"], state, "订单已持久化" if state == "pending" else "订单已取消", now
            )
            return self.public_job(row), True

    @staticmethod
    def _recover(db, now: float):
        expired = db.execute(
            "SELECT id,state FROM jobs WHERE state IN ('leased','sending') AND lease_until<?",
            (now,),
        ).fetchall()
        db.execute(
            "UPDATE jobs SET state='pending',worker_id=NULL,lease_token=NULL,lease_until=NULL,"
            "updated_at=? WHERE state='leased' AND lease_until<?",
            (now, now),
        )
        # The external send might have happened. Never automatically send it a second time.
        db.execute(
            "UPDATE jobs SET state='uncertain',lease_token=NULL,lease_until=NULL,"
            "last_error='worker interrupted after send started; inspect destination',updated_at=? "
            "WHERE state='sending' AND lease_until<?",
            (now, now),
        )
        for row in expired:
            state = "pending" if row["state"] == "leased" else "uncertain"
            note = (
                "领取超时，任务重新等待处理"
                if state == "pending"
                else "发送过程中失联，请核对目标端"
            )
            Store._record(db, row["id"], state, note, now)

    def recover(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._recover(db, time.time())

    def claim(self, worker_id: str, mode: str) -> dict | None:
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._recover(db, now)
            db.execute(
                "INSERT INTO workers VALUES(?,?,?) ON CONFLICT(worker_id) "
                "DO UPDATE SET mode=excluded.mode,last_seen=excluded.last_seen",
                (worker_id, mode, now),
            )
            if db.execute(
                "SELECT 1 FROM jobs WHERE worker_id=? AND state IN ('leased','sending')",
                (worker_id,),
            ).fetchone():
                return None
            row = db.execute(
                "SELECT j.* FROM jobs j WHERE j.state IN ('pending','retry') "
                "AND j.next_attempt<=? AND NOT EXISTS (SELECT 1 FROM jobs active "
                "WHERE active.state IN ('leased','sending','uncertain') "
                "AND active.store_id=j.store_id AND active.order_id=j.order_id) "
                "ORDER BY j.id LIMIT 1",
                (now,),
            ).fetchone()
            if row is None:
                return None
            token = secrets.token_urlsafe(24)
            until = now + self.config.lease_seconds
            db.execute(
                "UPDATE jobs SET state='leased',worker_id=?,mode=?,lease_token=?,lease_until=?,"
                "updated_at=? WHERE id=?",
                (worker_id, mode, token, until, now, row["id"]),
            )
            self._record(db, row["id"], "leased", f"发送端 {worker_id} 已领取（{mode}）", now)
            job = self.public_job(
                db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone()
            )
            job["lease_token"] = token
            return job

    @staticmethod
    def _leased_row(db, job_id: int, token: str, now: float):
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if (
            row is None
            or not row["lease_token"]
            or not secrets.compare_digest(row["lease_token"].encode(), token.encode())
            or row["state"] not in ("leased", "sending")
            or row["lease_until"] < now
        ):
            raise Conflict("lease expired, revoked, or not owned by this worker")
        return row

    def begin(self, job_id: int, token: str) -> dict:
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._leased_row(db, job_id, token, now)
            if row["state"] != "leased":
                raise Conflict("send already started")
            db.execute(
                "UPDATE jobs SET state='sending',attempts=attempts+1,updated_at=? WHERE id=?",
                (now, job_id),
            )
            self._record(db, job_id, "sending", "发送端已开始处理", now)
        return self.get(job_id)

    def finish(self, job_id: int, token: str, outcome: str, note: str = "") -> dict:
        if outcome not in {"sent", "simulated", "retry", "uncertain"}:
            raise ValueError("invalid outcome")
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._leased_row(db, job_id, token, now)
            if row["state"] != "sending":
                raise Conflict("begin the send before reporting a result")
            if row["mode"] == "mock" and outcome == "sent":
                raise Conflict("a mock worker cannot report a real message as sent")
            state = outcome
            next_attempt = 0
            if outcome == "retry":
                cancelled = (
                    row["event"] == "confirmed"
                    and db.execute(
                        "SELECT 1 FROM jobs WHERE store_id=? AND order_id=? AND event='cancelled'",
                        (row["store_id"], row["order_id"]),
                    ).fetchone()
                )
                state = (
                    "suppressed"
                    if cancelled
                    else ("dead" if row["attempts"] >= self.config.max_attempts else "retry")
                )
                next_attempt = now + min(300, 2 ** row["attempts"])
            db.execute(
                "UPDATE jobs SET state=?,last_error=?,next_attempt=?,lease_token=NULL,"
                "lease_until=NULL,updated_at=? WHERE id=?",
                (state, note[:1000], next_attempt, now, job_id),
            )
            self._record(db, job_id, state, note or f"发送端报告：{outcome}", now)
        return self.get(job_id)

    def retry(self, job_id: int, confirmed_unsent: bool = False) -> dict:
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                raise KeyError(job_id)
            if row["state"] not in {"dead", "retry", "uncertain"}:
                raise Conflict("only failed or uncertain jobs can be retried")
            if row["state"] == "uncertain" and not confirmed_unsent:
                raise Conflict("check the destination and confirm the message was not sent")
            if (
                row["event"] == "confirmed"
                and db.execute(
                    "SELECT 1 FROM jobs WHERE store_id=? AND order_id=? AND event='cancelled'",
                    (row["store_id"], row["order_id"]),
                ).fetchone()
            ):
                raise Conflict("order was cancelled; its confirmation cannot be resent")
            db.execute(
                "UPDATE jobs SET state='pending',attempts=0,next_attempt=0,worker_id=NULL,"
                "lease_token=NULL,lease_until=NULL,last_error='',updated_at=? WHERE id=?",
                (now, job_id),
            )
            self._record(db, job_id, "pending", "手动重新入队", now)
        return self.get(job_id)

    def resolve(self, job_id: int, outcome: str) -> dict:
        if outcome not in {"sent", "suppressed"}:
            raise ValueError("resolution must be sent or suppressed")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT mode FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is not None and row["mode"] == "mock" and outcome == "sent":
                raise Conflict("a mock result cannot be resolved as a real message sent")
            now = time.time()
            cursor = db.execute(
                "UPDATE jobs SET state=?,last_error='manually resolved',updated_at=? "
                "WHERE id=? AND state='uncertain'",
                (outcome, now, job_id),
            )
            if not cursor.rowcount:
                raise Conflict("only uncertain jobs can be resolved")
            self._record(db, job_id, outcome, "已核对并手动结束任务", now)
        return self.get(job_id)

    def get(self, job_id: int) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                raise KeyError(job_id)
            result = self.public_job(row)
            result["history"] = [
                dict(event)
                for event in db.execute(
                    "SELECT state,note,created_at FROM job_events WHERE job_id=? ORDER BY id",
                    (job_id,),
                )
            ]
            return result

    def list(self, state: str | None = None, limit: int = 50) -> list[dict]:
        if state is not None and state not in STATES:
            raise ValueError("invalid queue state")
        limit = max(1, min(limit, 100))
        with self.connect() as db:
            if state:
                rows = db.execute(
                    "SELECT * FROM jobs WHERE state=? ORDER BY id DESC LIMIT ?", (state, limit)
                )
            else:
                rows = db.execute("SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,))
            return [self.public_job(row) for row in rows]

    def status(self) -> dict:
        self.recover()
        with self.connect() as db:
            counts = {state: 0 for state in sorted(STATES)}
            counts.update(
                {
                    row["state"]: row["n"]
                    for row in db.execute("SELECT state,COUNT(*) AS n FROM jobs GROUP BY state")
                }
            )
            workers = [
                dict(row)
                for row in db.execute("SELECT * FROM workers ORDER BY last_seen DESC LIMIT 20")
            ]
        return {"counts": counts, "total": sum(counts.values()), "workers": workers}
