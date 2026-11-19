"""Reference sender implementation. This version only simulates delivery."""

from .client import BridgeClient, BridgeError


def run_once(client: BridgeClient, worker_id: str) -> dict | None:
    job = client.request("POST", "/api/worker/claim", {"worker_id": worker_id, "mode": "mock"})[
        "job"
    ]
    if job is None:
        return None
    lease = {"lease_token": job["lease_token"]}
    try:
        client.request("POST", f"/api/worker/{job['id']}/begin", lease)
    except BridgeError as exc:
        if exc.status == 409:
            # Cancellation or lease expiration: no send was attempted.
            return {"id": job["id"], "state": "skipped"}
        raise
    # A real sender replaces this step, using the immutable job.target + job.message.
    # Successful simulation must never be reported as a real WeChat submission.
    return client.request(
        "POST",
        f"/api/worker/{job['id']}/result",
        {**lease, "outcome": "simulated", "note": "模拟发送完成；没有操作微信"},
    )
