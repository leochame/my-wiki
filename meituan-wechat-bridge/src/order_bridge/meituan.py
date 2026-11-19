"""Brand-app callbacks only: app_id / consumer_secret / sig.

Protocol: https://developer.waimai.meituan.com/home/guide/41
Signature: https://developer.waimai.meituan.com/home/guide/42
The developerId/sign ISV protocol is deliberately not treated as this protocol.
"""

import hashlib
import hmac
import json
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl, unquote

from .config import Settings
from .models import Item, OrderEvent


class CallbackAuthError(ValueError):
    pass


def form_values(data: bytes, extra_decode: bool = False) -> dict[str, str]:
    values: dict[str, str] = {}
    for key, value in parse_qsl(
        data.decode("utf-8", errors="strict"),
        keep_blank_values=True,
        encoding="utf-8",
        errors="strict",
        max_num_fields=300,
    ):
        if key in values:
            raise ValueError("duplicate callback parameter")
        values[key] = unquote(value, encoding="utf-8", errors="strict") if extra_decode else value
    return values


def brand_signature(callback_url: str, params: dict[str, str], secret: str) -> str:
    canonical = "&".join(f"{key}={params[key]}" for key in sorted(params) if key != "sig")
    raw = f"{callback_url}?{canonical}{secret}".encode()
    # MD5 is the platform's mandated signature, not password storage.
    return hashlib.md5(raw, usedforsecurity=False).hexdigest()


def verify_brand_callback(
    path: str,
    query: bytes,
    body: bytes,
    settings: Settings,
) -> dict[str, str]:
    config = settings.config
    if not (settings.meituan_secret and config.meituan_app_id and config.callback_base_url):
        raise CallbackAuthError("brand callbacks are not configured")
    params = form_values(query)
    # Official precedence: form values override matching query parameters.
    params.update(form_values(body, extra_decode=config.meituan_decode_passes == 2))
    if "developerId" in params or "sign" in params:
        raise CallbackAuthError("developerId/sign requires the separate ISV callback adapter")
    if not hmac.compare_digest(params.get("app_id", "").encode(), config.meituan_app_id.encode()):
        raise CallbackAuthError("invalid callback identity or signature")
    expected = brand_signature(
        config.callback_base_url.rstrip("/") + path, params, settings.meituan_secret
    )
    if not hmac.compare_digest(params.get("sig", "").encode(), expected.encode()):
        raise CallbackAuthError("invalid callback identity or signature")
    try:
        timestamp = int(params["timestamp"])
    except (KeyError, ValueError) as exc:
        raise CallbackAuthError("invalid callback timestamp") from exc
    age = time.time() - timestamp
    if age < -300 or age > config.meituan_max_age_seconds:
        raise CallbackAuthError("callback timestamp outside configured replay window")
    return params


def parse_brand_order(params: dict[str, str], status: str) -> OrderEvent:
    if "order" in params:
        order = json.loads(params["order"])
        if not isinstance(order, dict):
            raise ValueError("order must be a JSON object")
    else:
        order = params
    detail = order.get("detail", [])
    if isinstance(detail, str):
        detail = json.loads(detail)
    if not isinstance(detail, list):
        raise ValueError("detail must be a JSON array")
    items = []
    for food in detail:
        if not isinstance(food, dict):
            raise ValueError("invalid item detail")
        spec = str(food.get("spec", ""))
        if food.get("food_property"):
            spec = " / ".join(filter(None, [spec, str(food["food_property"])]))
        items.append(Item(name=food["food_name"], quantity=food["quantity"], spec=spec))
    delivery_time = order.get("delivery_time", "")
    if str(delivery_time) == "0":
        delivery_time = "立即配送"
    elif delivery_time:
        # Do not invent timezone semantics; keep platform-provided time as received.
        delivery_time = str(delivery_time)
    amount_fen = None
    if order.get("total") not in (None, ""):
        try:
            amount = Decimal(str(order["total"])) * 100
            if not amount.is_finite() or amount != amount.to_integral_value():
                raise ValueError("invalid order amount precision")
            amount_fen = int(amount)
        except (InvalidOperation, ValueError, OverflowError) as exc:
            raise ValueError("invalid order total") from exc
    return OrderEvent(
        order_id=str(order["order_id"]),
        store_id=str(order["app_poi_code"]),
        store_name=str(order.get("wm_poi_name", "")),
        status=status,
        day_seq=str(order.get("day_seq", "")),
        items=items,
        remark=str(order.get("caution", "")),
        delivery_time=str(delivery_time),
        amount_fen=amount_fen,
    )
