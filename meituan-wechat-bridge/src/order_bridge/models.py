from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Item(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    name: str = Field(min_length=1, max_length=200)
    quantity: Decimal = Field(gt=0, le=10000, max_digits=10, decimal_places=3)
    spec: str = Field(default="", max_length=500)


class OrderEvent(BaseModel):
    # Retain only fields needed for notifications, never the complete platform payload.
    model_config = ConfigDict(extra="ignore")

    order_id: str = Field(min_length=1, max_length=100)
    store_id: str = Field(min_length=1, max_length=100)
    store_name: str = Field(default="", max_length=200)
    status: Literal["confirmed", "cancelled"]
    day_seq: str = Field(default="", max_length=40)
    items: list[Item] = Field(default_factory=list, max_length=100)
    remark: str = Field(default="", max_length=2000)
    delivery_time: str = Field(default="", max_length=100)
    amount_fen: int | None = Field(default=None, ge=0, le=100_000_000)

    @model_validator(mode="after")
    def require_items(self) -> "OrderEvent":
        if self.status == "confirmed" and not self.items:
            raise ValueError("confirmed orders require at least one item")
        return self


class Route(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_name: str = Field(min_length=1, max_length=200)


class BridgeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    routes: dict[str, Route] = Field(default_factory=dict)
    meituan_app_id: str = ""
    callback_base_url: str = ""
    # Brand callback POST parameters are form decoded and then percent decoded.
    # A value of 1 supports integrations that use a single encoding pass.
    meituan_decode_passes: Literal[1, 2] = 2
    meituan_max_age_seconds: int = Field(default=86400, ge=300, le=604800)
    lease_seconds: int = Field(default=180, ge=60, le=3600)
    max_attempts: int = Field(default=5, ge=1, le=20)


def single_line(value: str) -> str:
    return " ".join(value.split())


def format_message(order: OrderEvent) -> str:
    title = "新订单（已接单）" if order.status == "confirmed" else "订单已取消"
    lines = [f"【美团｜{title}】"]
    lines.append(f"门店：{single_line(order.store_name or order.store_id)}")
    if order.day_seq:
        lines.append(f"流水号：{single_line(order.day_seq)}")
    lines.append(f"订单号：{single_line(order.order_id)}")
    for item in order.items:
        quantity = format(item.quantity.normalize(), "f")
        spec = f"（{single_line(item.spec)}）" if item.spec else ""
        lines.append(f"• {single_line(item.name)}{spec} × {quantity}")
    if order.amount_fen is not None:
        amount = Decimal(order.amount_fen) / 100
        lines.append(f"订单金额：¥{amount:.2f}")
    if order.delivery_time:
        lines.append(f"送达时间：{single_line(order.delivery_time)}")
    if order.remark:
        lines.append(f"备注：{single_line(order.remark)}")
    message = "\n".join(lines)
    if len(message) > 12000:
        raise ValueError("order notification exceeds 12000 characters; split the source order")
    return message
