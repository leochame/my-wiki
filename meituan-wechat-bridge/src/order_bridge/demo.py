import uuid

from .models import Item, OrderEvent


def demo_order() -> OrderEvent:
    return OrderEvent(
        order_id=f"demo-{uuid.uuid4().hex[:12]}",
        store_id="demo-store",
        store_name="示例门店",
        status="confirmed",
        day_seq="32",
        items=[Item(name="鸡腿饭", quantity=2, spec="微辣"), Item(name="酸梅汤", quantity=1)],
        remark="演示订单：不要香菜，餐具两份",
        delivery_time="立即配送",
        amount_fen=4200,
    )
