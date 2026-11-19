from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from order_bridge.app import create_app
from order_bridge.config import Settings
from order_bridge.demo import demo_order
from order_bridge.models import BridgeConfig, Route


@pytest.fixture
def order():
    return demo_order().model_copy(update={"order_id": "test-order"})


@pytest.fixture
def settings(tmp_path):
    return Settings(
        data_dir=tmp_path,
        api_token="test-only-management-token",
        meituan_secret="test-only-platform-secret",
        config=BridgeConfig(
            routes={"demo-store": Route(group_name="测试备餐群")},
            meituan_app_id="test-app",
            callback_base_url="https://orders.example.com",
            max_attempts=2,
        ),
    )


@pytest.fixture
def app(settings):
    return create_app(settings, demo_worker=False)


@pytest.fixture
def client(app, settings):
    with TestClient(app, headers={"Authorization": f"Bearer {settings.api_token}"}) as client:
        yield client


@pytest.fixture
def demo_client(settings):
    with TestClient(create_app(replace(settings, demo=True), demo_worker=False)) as client:
        yield client
