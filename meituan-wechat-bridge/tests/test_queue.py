from concurrent.futures import ThreadPoolExecutor

import pytest

from order_bridge.models import Route
from order_bridge.store import Conflict, Store


def store_for(settings):
    return Store(settings.data_dir, settings.config)


def expire(store, job_id):
    with store.connect() as db:
        db.execute("UPDATE jobs SET lease_until=1 WHERE id=?", (job_id,))


def test_duplicate_callbacks_are_atomic(settings, order):
    store = store_for(settings)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: store.ingest(order), range(20)))
    assert sum(created for _, created in results) == 1
    assert {job["id"] for job, _ in results} == {1}
    assert store.status()["total"] == 1


def test_order_ids_are_scoped_to_store(settings, order):
    store = store_for(settings)
    store.set_route("second", Route(group_name="另一门店群"))
    store.ingest(order)
    store.ingest(order.model_copy(update={"store_id": "second"}))
    assert store.status()["total"] == 2


def test_routes_are_snapshots_and_survive_restart(settings, order):
    store = store_for(settings)
    first, _ = store.ingest(order)
    store.set_route(order.store_id, Route(group_name="新备餐群"))
    restarted = store_for(settings)
    second, _ = restarted.ingest(order.model_copy(update={"order_id": "next-order"}))
    assert first["target"]["group_name"] == "测试备餐群"
    assert restarted.get(first["id"])["target"]["group_name"] == "测试备餐群"
    assert second["target"]["group_name"] == "新备餐群"
    cancelled, _ = restarted.ingest(order.model_copy(update={"status": "cancelled"}))
    assert cancelled["target"]["group_name"] == first["target"]["group_name"]


def test_unknown_stores_do_not_silently_fall_back(settings, order):
    store = store_for(settings)
    with pytest.raises(ValueError, match="unknown store"):
        store.ingest(order.model_copy(update={"store_id": "unknown"}))
    assert store.status()["total"] == 0


def test_cancellation_arriving_first_suppresses_confirmation(settings, order):
    store = store_for(settings)
    store.ingest(order.model_copy(update={"status": "cancelled"}))
    confirmed, _ = store.ingest(order)
    assert confirmed["state"] == "suppressed"
    assert store.claim("worker", "mock")["event"] == "cancelled"


def test_cancellation_revokes_unstarted_lease(settings, order):
    store = store_for(settings)
    confirmed, _ = store.ingest(order)
    leased = store.claim("worker", "mock")
    store.ingest(order.model_copy(update={"status": "cancelled"}))
    with pytest.raises(Conflict):
        store.begin(leased["id"], leased["lease_token"])
    assert store.get(confirmed["id"])["state"] == "suppressed"


def test_concurrent_claims_do_not_share_jobs(settings, order):
    store = store_for(settings)
    for i in range(10):
        store.ingest(order.model_copy(update={"order_id": f"order-{i}"}))
    with ThreadPoolExecutor(max_workers=8) as pool:
        claims = list(pool.map(lambda i: store.claim(f"worker-{i}", "mock"), range(10)))
    assert len({job["id"] for job in claims if job}) == 10
    assert all("lease_token" not in job for job in store.list())


def test_worker_cannot_claim_a_second_job(settings, order):
    store = store_for(settings)
    store.ingest(order)
    store.ingest(order.model_copy(update={"order_id": "another"}))
    assert store.claim("worker", "mock") is not None
    assert store.claim("worker", "mock") is None


def test_expired_unstarted_lease_is_recoverable(settings, order):
    store = store_for(settings)
    store.ingest(order)
    old = store.claim("old-worker", "mock")
    expire(store, old["id"])
    restarted = store_for(settings)
    new = restarted.claim("new-worker", "mock")
    assert new["id"] == old["id"]
    assert new["lease_token"] != old["lease_token"]
    with pytest.raises(Conflict):
        restarted.begin(old["id"], old["lease_token"])


def test_interruption_after_begin_never_automatically_resends(settings, order):
    store = store_for(settings)
    store.ingest(order)
    claim = store.claim("worker", "wechat-macos")
    store.begin(claim["id"], claim["lease_token"])
    expire(store, claim["id"])
    restarted = store_for(settings)
    assert restarted.claim("replacement", "wechat-macos") is None
    assert restarted.get(claim["id"])["state"] == "uncertain"
    with pytest.raises(Conflict, match="confirm"):
        restarted.retry(claim["id"])
    restarted.retry(claim["id"], confirmed_unsent=True)
    assert restarted.claim("replacement", "wechat-macos") is not None


def test_retry_limit_and_manual_requeue(settings, order):
    store = store_for(settings)
    job, _ = store.ingest(order)
    for i in range(2):
        claim = store.claim("worker", "mock")
        store.begin(claim["id"], claim["lease_token"])
        result = store.finish(claim["id"], claim["lease_token"], "retry", "not submitted")
        if i == 0:
            assert result["state"] == "retry"
            assert store.claim("worker", "mock") is None
            with store.connect() as db:
                db.execute("UPDATE jobs SET next_attempt=0 WHERE id=?", (job["id"],))
    assert result["state"] == "dead"
    assert store.claim("worker", "mock") is None
    assert store.retry(job["id"])["state"] == "pending"


def test_cancelled_confirmations_cannot_be_retried(settings, order):
    store = store_for(settings)
    store.ingest(order)
    claim = store.claim("worker", "wechat-macos")
    store.begin(claim["id"], claim["lease_token"])
    store.ingest(order.model_copy(update={"status": "cancelled"}))
    store.finish(claim["id"], claim["lease_token"], "uncertain")
    assert store.claim("another-worker", "mock") is None
    with pytest.raises(Conflict, match="cancelled"):
        store.retry(claim["id"], confirmed_unsent=True)
    store.resolve(claim["id"], "suppressed")
    assert store.claim("another-worker", "mock")["event"] == "cancelled"


def test_cancel_during_failed_send_stops_confirmation_retry(settings, order):
    store = store_for(settings)
    store.ingest(order)
    claim = store.claim("worker", "mock")
    store.begin(claim["id"], claim["lease_token"])
    store.ingest(order.model_copy(update={"status": "cancelled"}))
    result = store.finish(claim["id"], claim["lease_token"], "retry")
    assert result["state"] == "suppressed"
    assert store.claim("worker", "mock")["event"] == "cancelled"


def test_mock_delivery_cannot_be_reported_as_sent(settings, order):
    store = store_for(settings)
    store.ingest(order)
    claim = store.claim("worker", "mock")
    with pytest.raises(Conflict, match="begin"):
        store.finish(claim["id"], claim["lease_token"], "simulated")
    store.begin(claim["id"], claim["lease_token"])
    with pytest.raises(Conflict, match="mock"):
        store.finish(claim["id"], claim["lease_token"], "sent")
    assert store.finish(claim["id"], claim["lease_token"], "simulated")["state"] == "simulated"


def test_processing_history_survives_restart_without_duplicate_recovery_events(settings, order):
    store = store_for(settings)
    job, _ = store.ingest(order)
    claimed = store.claim("worker", "mock")
    store.begin(claimed["id"], claimed["lease_token"])
    expire(store, job["id"])
    restarted = store_for(settings)
    restarted.recover()
    restarted.recover()
    states = [entry["state"] for entry in restarted.get(job["id"])["history"]]
    assert states == ["pending", "leased", "sending", "uncertain"]
    with pytest.raises(Conflict, match="mock"):
        restarted.resolve(job["id"], "sent")
