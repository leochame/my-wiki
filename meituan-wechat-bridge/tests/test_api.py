import json
import time
from urllib.parse import quote, urlencode

import pytest
from fastapi.testclient import TestClient

from order_bridge.client import BridgeClient
from order_bridge.meituan import brand_signature
from order_bridge.worker import run_once


def raw_brand_params(settings):
    return {
        "app_id": settings.config.meituan_app_id,
        "timestamp": str(int(time.time())),
        "order_id": "1234567890123456789",
        "app_poi_code": "demo-store",
        "wm_poi_name": "测试门店",
        "day_seq": "32",
        "detail": json.dumps(
            [
                {"food_name": "鸡腿饭", "quantity": 2, "spec": "微辣", "food_property": "加饭"},
            ],
            ensure_ascii=False,
        ),
        "caution": "少辣 + 不要香菜，折扣 10%",
        "delivery_time": "0",
        "total": "42.00",
        "recipient_phone": "13800000000",
        "recipient_address": "不应保存的地址",
        "new_platform_field": "future value",
        "empty_field": "",
    }


def brand_body(path, params, settings):
    params = dict(params)
    params["sig"] = brand_signature(
        settings.config.callback_base_url + path, params, settings.meituan_secret
    )
    encoded = {key: quote(value, safe="") for key, value in params.items()}
    return urlencode(encoded).encode()


def test_management_auth_and_public_health(app):
    with TestClient(app) as client:
        assert client.get("/healthz").json()["status"] == "ok"
        assert client.get("/").status_code == 200
        assert client.get("/api/jobs").status_code == 401
        assert (
            client.get("/api/status", headers={"Authorization": "Bearer wrong"}).status_code == 401
        )


def test_ingestion_preview_deduplication_and_privacy(client, order):
    payload = order.model_dump(mode="json") | {"recipient_phone": "13800000000"}
    assert client.post("/api/preview", json=payload).json()["queued"] is False
    assert client.get("/api/status").json()["total"] == 0
    first = client.post("/api/orders", json=payload)
    assert first.status_code == 200
    assert first.json()["created"] is True
    assert "13800000000" not in first.text
    assert client.post("/api/orders", json=payload).json()["created"] is False
    assert client.get("/api/status").json()["total"] == 1


def test_unknown_store_and_invalid_items_rejected(client, order):
    payload = order.model_dump(mode="json")
    assert client.post("/api/orders", json=payload | {"store_id": "unknown"}).status_code == 422
    assert client.post("/api/orders", json=payload | {"items": []}).status_code == 422
    payload["items"][0]["quantity"] = 0
    assert client.post("/api/orders", json=payload).status_code == 422
    assert client.get("/api/status").json()["total"] == 0


def test_post_callback_double_encoding_and_retries(client, settings):
    path = "/webhooks/meituan/confirmed"
    body = brand_body(path, raw_brand_params(settings), settings)
    for _ in range(2):
        response = client.post(
            path, content=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        assert response.json() == {"data": "ok"}
    job = client.get("/api/jobs").json()[0]
    assert job["payload"]["remark"] == "少辣 + 不要香菜，折扣 10%"
    assert job["payload"]["amount_fen"] == 4200
    assert "不应保存的地址" not in json.dumps(job, ensure_ascii=False)
    assert "13800000000" not in json.dumps(job)
    assert client.get("/api/status").json()["total"] == 1


def test_get_callback_uses_public_url_not_incoming_host(client, settings):
    path = "/webhooks/meituan/confirmed"
    params = raw_brand_params(settings)
    params["sig"] = brand_signature(
        settings.config.callback_base_url + path, params, settings.meituan_secret
    )
    response = client.get(path, params=params, headers={"X-Forwarded-Host": "attacker.invalid"})
    assert response.json() == {"data": "ok"}


def test_invalid_signature_never_creates_job(client, settings):
    path = "/webhooks/meituan/confirmed"
    body = brand_body(path, raw_brand_params(settings), settings)
    response = client.post(
        path,
        content=body.replace(b"test-app", b"fake-app"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 401
    assert client.get("/api/status").json()["total"] == 0


def test_unknown_future_field_must_participate_in_signature(client, settings):
    path = "/webhooks/meituan/confirmed"
    body = brand_body(path, raw_brand_params(settings), settings)
    body = body.replace(b"future%2520value", b"changed%2520value")
    assert (
        client.post(
            path, content=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
        ).status_code
        == 401
    )


def test_expired_but_correctly_signed_callback_rejected(client, settings):
    path = "/webhooks/meituan/confirmed"
    params = raw_brand_params(settings) | {"timestamp": "1"}
    assert (
        client.post(
            path,
            content=brand_body(path, params, settings),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ).status_code
        == 401
    )


def test_isv_protocol_not_misinterpreted(client):
    response = client.post(
        "/webhooks/meituan/confirmed",
        data={"developerId": "123", "sign": "test-only-isv-placeholder"},
    )
    assert response.status_code == 401
    assert "ISV" in response.json()["detail"]


def test_platform_heartbeat_and_body_limits(client, order):
    assert client.post("/webhooks/meituan/confirmed").json() == {"data": "ok"}
    assert client.get("/api/status").json()["total"] == 0
    assert client.post("/api/orders", content=b"x" * (256 * 1024 + 1)).status_code == 413
    assert client.post("/webhooks/meituan/confirmed", json={"data": "x"}).status_code == 415


def test_repeated_form_keys_are_rejected(client, settings):
    body = brand_body("/webhooks/meituan/confirmed", raw_brand_params(settings), settings)
    response = client.post(
        "/webhooks/meituan/confirmed",
        content=body + b"&app_id=other",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 422


def test_mock_worker_http_contract(client, order):
    submitted = client.post("/api/orders", json=order.model_dump(mode="json")).json()["job"]
    bridge = BridgeClient("http://127.0.0.1:8787")
    bridge.http.close()
    bridge.http = client
    result = run_once(bridge, "integration-worker")
    assert result["state"] == "simulated"
    assert result["id"] == submitted["id"]
    assert run_once(bridge, "integration-worker") is None
    assert client.get("/api/status").json()["counts"]["sent"] == 0


def test_queue_api_state_conflicts_and_lease_auth(client, order):
    client.post("/api/orders", json=order.model_dump(mode="json"))
    job = client.post("/api/worker/claim", json={"worker_id": "test", "mode": "mock"}).json()["job"]
    assert (
        client.post(f"/api/worker/{job['id']}/begin", json={"lease_token": "wrong"}).status_code
        == 409
    )
    lease = {"lease_token": job["lease_token"]}
    assert client.post(f"/api/worker/{job['id']}/begin", json=lease).status_code == 200
    assert (
        client.post(
            f"/api/worker/{job['id']}/result", json={**lease, "outcome": "sent"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/worker/{job['id']}/result", json={**lease, "outcome": "simulated"}
        ).status_code
        == 200
    )
    assert client.post(f"/api/jobs/{job['id']}/retry", json={}).status_code == 409
    assert client.get("/api/jobs/999").status_code == 404


def test_demo_is_explicit_and_cannot_receive_real_callbacks(client, demo_client):
    assert client.post("/api/demo/orders").status_code == 404
    assert demo_client.post("/api/demo/orders").json()["created"] is True
    assert demo_client.get("/api/status").json()["demo"] is True
    assert demo_client.post("/webhooks/meituan/confirmed").status_code == 503


@pytest.mark.parametrize(
    "url", ["http://example.com", "https://user:secret@example.com", "ftp://local"]
)
def test_remote_api_credentials_require_safe_urls(url):
    with pytest.raises(ValueError):
        BridgeClient(url)


def test_management_responses_do_not_disclose_secrets(client, settings):
    response = client.get("/api/status")
    assert settings.api_token not in response.text
    assert settings.meituan_secret not in response.text


def test_error_responses_do_not_echo_order_input(client):
    response = client.post("/api/orders", json={"order_id": "sensitive-input"})
    assert response.status_code == 422
    assert "sensitive-input" not in response.text
