import asyncio
import contextlib
import json
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from .config import Settings
from .demo import demo_order
from .meituan import CallbackAuthError, parse_brand_order, verify_brand_callback
from .models import OrderEvent, Route, format_message
from .store import Conflict, Store

MAX_BODY = 256 * 1024


async def limited_body(request: Request) -> bytes:
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BODY:
            raise HTTPException(413, "request body exceeds 256 KiB")
    return bytes(data)


class Claim(BaseModel):
    worker_id: str = Field(min_length=1, max_length=100)
    mode: Literal["mock", "wechat-macos"] = "mock"


class Lease(BaseModel):
    lease_token: str = Field(min_length=1, max_length=200)


class Result(Lease):
    outcome: Literal["sent", "simulated", "retry", "uncertain"]
    note: str = Field(default="", max_length=1000)


class Retry(BaseModel):
    confirmed_unsent: bool = False


class Resolve(BaseModel):
    outcome: Literal["sent", "suppressed"]


async def run_demo_worker(store: Store):
    while True:
        await asyncio.to_thread(store.recover)
        job = await asyncio.to_thread(store.claim, "builtin-demo", "mock")
        if job:
            try:
                await asyncio.to_thread(store.begin, job["id"], job["lease_token"])
                await asyncio.sleep(0.6)
                await asyncio.to_thread(
                    store.finish,
                    job["id"],
                    job["lease_token"],
                    "simulated",
                    "模拟发送完成；没有操作微信",
                )
            except Conflict:
                pass  # A concurrent cancellation may have revoked the unstarted lease.
        await asyncio.sleep(1)


def create_app(settings: Settings | None = None, *, demo_worker: bool = True) -> FastAPI:
    settings = settings or Settings.load()
    store = Store(settings.data_dir, settings.config)

    @asynccontextmanager
    async def lifespan(app):
        task = None
        if settings.demo and demo_worker:
            task = asyncio.create_task(run_demo_worker(store))
        try:
            yield
        finally:
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(title="美团订单通知桥", version="0.1.0", lifespan=lifespan)
    app.state.store = store
    app.state.settings = settings
    security = HTTPBearer(auto_error=False)

    def authorize(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)]):
        if settings.demo:
            return
        if not settings.api_token:
            raise HTTPException(503, "set BRIDGE_API_TOKEN before using the management API")
        if not credentials or not secrets.compare_digest(
            credentials.credentials.encode(), settings.api_token.encode()
        ):
            raise HTTPException(401, "invalid bearer token", headers={"WWW-Authenticate": "Bearer"})

    authorized = [Depends(authorize)]

    @app.exception_handler(Conflict)
    async def conflict_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(KeyError)
    async def not_found_handler(request, exc):
        return JSONResponse(status_code=404, content={"detail": "record not found"})

    @app.exception_handler(ValueError)
    async def value_error_handler(request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def validation_error_handler(request, exc):
        errors = [
            {key: error[key] for key in ("type", "loc", "msg") if key in error}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.get("/healthz")
    def health():
        return {"status": "ok", "demo": settings.demo}

    @app.get("/api/status", dependencies=authorized)
    def status():
        return {
            **settings.public_status(),
            **store.status(),
            "configured_stores": sorted(store.routes()),
        }

    @app.get("/api/routes", dependencies=authorized)
    def routes():
        return store.routes()

    @app.put("/api/routes/{store_id}", dependencies=authorized)
    def set_route(store_id: str, route: Route):
        if not store_id.strip() or len(store_id) > 100:
            raise HTTPException(422, "store_id must contain 1-100 characters")
        store.set_route(store_id, route)
        return {"store_id": store_id, **route.model_dump()}

    async def read_order(request: Request) -> OrderEvent:
        return OrderEvent.model_validate_json(await limited_body(request))

    @app.post("/api/orders", dependencies=authorized)
    async def ingest(request: Request):
        job, created = await asyncio.to_thread(store.ingest, await read_order(request))
        return {"created": created, "job": job}

    @app.post("/api/preview", dependencies=authorized)
    async def preview(request: Request):
        order = await read_order(request)
        route = store.routes().get(order.store_id)
        return {"message": format_message(order), "target": route, "queued": False}

    @app.get("/api/jobs", dependencies=authorized)
    def jobs(state: str | None = None, limit: int = Query(default=50, ge=1, le=100)):
        return store.list(state, limit)

    @app.get("/api/jobs/{job_id}", dependencies=authorized)
    def job(job_id: int):
        return store.get(job_id)

    @app.post("/api/jobs/{job_id}/retry", dependencies=authorized)
    def retry(job_id: int, body: Retry):
        return store.retry(job_id, body.confirmed_unsent)

    @app.post("/api/jobs/{job_id}/resolve", dependencies=authorized)
    def resolve(job_id: int, body: Resolve):
        return store.resolve(job_id, body.outcome)

    @app.post("/api/worker/claim", dependencies=authorized)
    def claim(body: Claim):
        return {"job": store.claim(body.worker_id, body.mode)}

    @app.post("/api/worker/{job_id}/begin", dependencies=authorized)
    def begin(job_id: int, body: Lease):
        return store.begin(job_id, body.lease_token)

    @app.post("/api/worker/{job_id}/result", dependencies=authorized)
    def result(job_id: int, body: Result):
        return store.finish(job_id, body.lease_token, body.outcome, body.note)

    @app.post("/api/demo/orders", dependencies=authorized)
    def add_demo():
        if not settings.demo:
            raise HTTPException(404, "available only in local demo mode")
        job, created = store.ingest(demo_order())
        return {"created": created, "job": job}

    @app.post("/api/demo/jobs/{job_id}/cancel", dependencies=authorized)
    def cancel_demo(job_id: int):
        if not settings.demo:
            raise HTTPException(404, "available only in local demo mode")
        original = store.get(job_id)
        order = OrderEvent.model_validate(original["payload"]).model_copy(
            update={"status": "cancelled", "remark": "演示：订单已取消，请停止备餐"}
        )
        job, created = store.ingest(order)
        return {"created": created, "job": job}

    @app.get("/webhooks/meituan/{event}", operation_id="meituan_get_callback")
    @app.post("/webhooks/meituan/{event}", operation_id="meituan_post_callback")
    async def meituan(event: str, request: Request):
        if settings.demo:
            raise HTTPException(503, "real platform callbacks are disabled in demo mode")
        if event not in {"confirmed", "cancelled"}:
            raise HTTPException(404, "unsupported callback event")
        if not settings.public_status()["brand_callback_configured"]:
            raise HTTPException(503, "brand callback adapter is not configured")
        body = await limited_body(request)
        query = request.scope.get("query_string", b"")
        if not body and not query:
            return {"data": "ok"}  # Platform's empty heartbeat; no order is inserted.
        if body and not request.headers.get("content-type", "").startswith(
            "application/x-www-form-urlencoded"
        ):
            raise HTTPException(415, "brand callbacks require form-urlencoded data")
        try:
            params = verify_brand_callback(request.url.path, query, body, settings)
        except CallbackAuthError as exc:
            raise HTTPException(401, str(exc)) from exc
        try:
            order = parse_brand_order(params, event)
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise HTTPException(422, "invalid brand order payload") from exc
        # Commit before acknowledging; desktop sending never blocks the callback.
        await asyncio.to_thread(store.ingest, order)
        return {"data": "ok"}

    static = Path(__file__).parent / "static"
    app.mount("/assets", StaticFiles(directory=static), name="assets")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(static / "index.html")

    return app
