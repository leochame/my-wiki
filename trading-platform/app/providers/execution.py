from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from decimal import Decimal

import httpx

from app.models import OrderRequest, OrderResult


class ExecutionProvider(ABC):
    name: str

    @abstractmethod
    async def submit(self, order: OrderRequest) -> OrderResult:
        raise NotImplementedError


class PaperExecution(ExecutionProvider):
    name = "paper"

    async def submit(self, order: OrderRequest) -> OrderResult:
        return OrderResult(
            order_id=f"paper-{uuid.uuid4().hex[:12]}",
            status="accepted",
            mode="paper",
            provider=self.name,
            message=f"模拟订单：{order.side} {order.quantity} {order.symbol}",
        )


class SchwabExecution(ExecutionProvider):
    name = "schwab"

    def __init__(self, base_url: str, access_token: str, account_hash: str):
        self._base_url = base_url.rstrip("/")
        self._access_token = access_token
        self._account_hash = account_hash

    async def submit(self, order: OrderRequest) -> OrderResult:
        payload = self._payload(order)
        url = f"{self._base_url}/trader/v1/accounts/{self._account_hash}/orders"
        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            detail = response.text[:500]
            raise RuntimeError(f"Schwab order rejected ({response.status_code}): {detail}")
        location = response.headers.get("Location", "")
        order_id = location.rstrip("/").split("/")[-1] if location else "submitted"
        return OrderResult(
            order_id=order_id,
            status="submitted",
            mode="live",
            provider=self.name,
            message="订单已提交到嘉信，成交状态请通过订单查询接口确认",
        )

    @staticmethod
    def _payload(order: OrderRequest) -> dict:
        instruction = "BUY" if order.side == "buy" else "SELL"
        leg = {
            "instruction": instruction,
            "quantity": float(order.quantity),
            "instrument": {"symbol": order.symbol, "assetType": "EQUITY"},
        }
        payload = {
            "orderType": "MARKET" if order.order_type == "market" else "LIMIT",
            "session": "NORMAL",
            "duration": "DAY",
            "orderStrategyType": "SINGLE",
            "orderLegCollection": [leg],
        }
        if order.limit_price is not None:
            payload["price"] = str(order.limit_price)
        return payload
