"""Price calculation for orders."""

from models import Order, Product

TAX_RATE = 0.13
VIP_THRESHOLD = 1000.0


def calculate_total(order, catalog, member_level="basic", coupon=None):
    """Compute the payable amount for an order."""
    subtotal = 0.0
    for item in order.items:
        product = catalog.get(item.sku)
        if product is None:
            continue
        subtotal += product.price * item.quantity
    if member_level == "vip":
        subtotal = subtotal * 0.9
    elif member_level == "svip":
        subtotal = subtotal * 0.85
    if subtotal > VIP_THRESHOLD:
        subtotal = subtotal - 50.0
    if coupon is not None and subtotal > 200.0:
        subtotal = subtotal - coupon
    total = subtotal * (1 + TAX_RATE)
    return round(total, 2)


def fmt(amount):
    """Format an amount as a two-decimal string."""
    return f"{amount:.2f}"
