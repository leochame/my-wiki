from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from app.models import Candle, Quote


class MarketDataProvider(ABC):
    name: str

    @abstractmethod
    async def quote(self, symbol: str) -> Quote:
        raise NotImplementedError

    @abstractmethod
    async def candles(self, symbol: str, count: int) -> list[Candle]:
        raise NotImplementedError


def _value(value: Any, default: Any = None) -> Any:
    """Read SDK objects without coupling the API layer to protobuf details."""
    return value if value is not None else default


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromtimestamp(int(value), tz=timezone.utc)


class UnconfiguredMarketData(MarketDataProvider):
    name = "unconfigured"

    async def quote(self, symbol: str) -> Quote:
        raise RuntimeError("长桥行情未配置，无法获取真实报价")

    async def candles(self, symbol: str, count: int) -> list[Candle]:
        raise RuntimeError("长桥行情未配置，无法获取真实 K 线")


class LongbridgeMarketData(MarketDataProvider):
    name = "longbridge"

    def __init__(self, app_key: str, app_secret: str, access_token: str):
        self._credentials = (app_key, app_secret, access_token)
        self._context = None

    def _ctx(self):
        if self._context is None:
            try:
                from longbridge.openapi import Config, QuoteContext
            except ImportError as exc:
                raise RuntimeError("install the longbridge package to use Longbridge market data") from exc
            config = Config.from_apikey(*self._credentials)
            self._context = QuoteContext(config)
        return self._context

    async def quote(self, symbol: str) -> Quote:
        return await asyncio.to_thread(self._quote_sync, symbol)

    def _quote_sync(self, symbol: str) -> Quote:
        response = self._ctx().quote([symbol])
        if not response:
            raise LookupError(f"Longbridge returned no quote for {symbol}")
        row = response[0]
        return Quote(
            symbol=str(_value(getattr(row, "symbol", None), symbol)),
            last=_decimal(getattr(row, "last_done", None)),
            previous_close=_decimal(getattr(row, "prev_close", None)),
            open=_decimal(getattr(row, "open", None)),
            high=_decimal(getattr(row, "high", None)),
            low=_decimal(getattr(row, "low", None)),
            volume=getattr(row, "volume", None),
            timestamp=_timestamp(getattr(row, "timestamp", None)),
            source=self.name,
        )

    async def candles(self, symbol: str, count: int) -> list[Candle]:
        return await asyncio.to_thread(self._candles_sync, symbol, count)

    def _candles_sync(self, symbol: str, count: int) -> list[Candle]:
        from longbridge.openapi import AdjustType, Period

        response = self._ctx().candlesticks(symbol, Period.Day, count, AdjustType.NoAdjust)
        return [
            Candle(
                timestamp=_timestamp(getattr(row, "timestamp", None)),
                open=_decimal(getattr(row, "open", None)),
                high=_decimal(getattr(row, "high", None)),
                low=_decimal(getattr(row, "low", None)),
                close=_decimal(getattr(row, "close", None)),
                volume=getattr(row, "volume", None),
            )
            for row in response
        ]
