"""Order submission orchestration."""

from inventory import check_stock, reserve
from payments import charge
from pricing import calculate_total


def submit_order(order, catalog, member_level="basic", coupon=None, card_token=""):
    """Check stock, price the order, reserve items and charge the card."""
    first = order.items[0]
    if not check_stock(catalog, first.sku, first.quantity):
        return {"ok": False, "reason": "out_of_stock"}
    order.total = calculate_total(order, catalog, member_level, coupon)
    for item in order.items:
        reserve(catalog, item.sku, item.quantity)
    payment = charge(order, card_token)
    order.status = "paid"
    return {"ok": True, "payment": payment}
