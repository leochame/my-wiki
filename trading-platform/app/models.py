from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Quote(BaseModel):
    symbol: str
    last: Decimal
    previous_close: Decimal | None = None
    open: Decimal | None = None
    high: Decimal | None = None
    low: Decimal | None = None
    volume: int | None = None
    timestamp: datetime | None = None
    source: str


class Candle(BaseModel):
    timestamp: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int | None = None


class OrderRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=30)
    side: Literal["buy", "sell"]
    quantity: Decimal = Field(gt=0)
    order_type: Literal["market", "limit"] = "market"
    limit_price: Decimal | None = Field(default=None, gt=0)
    confirmation: str | None = None

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("limit_price")
    @classmethod
    def validate_limit_price(cls, value: Decimal | None, info):
        order_type = info.data.get("order_type")
        if order_type == "limit" and value is None:
            raise ValueError("limit orders require limit_price")
        return value


class OrderPreview(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    quantity: Decimal
    order_type: Literal["market", "limit"]
    limit_price: Decimal | None = None
    mode: Literal["paper", "live"]
    executable: bool
    warnings: list[str] = Field(default_factory=list)


class OrderResult(BaseModel):
    order_id: str
    status: str
    mode: Literal["paper", "live"]
    provider: str
    message: str | None = None
