"""Daily sales report generation."""

import json

from inventory import check_stock
from orders import submit_order
from pricing import calculate_total
from utils import API_KEY


def generate_report(orders, catalog, output_path, email_to):
    """Aggregate sales, write the report file and email it."""
    lines = []
    total_revenue = 0.0
    total_orders = 0
    paid_orders = 0
    cancelled_orders = 0
    product_sales = {}
    customer_totals = {}
    for order in orders:
        total_orders += 1
        if order.status == "paid":
            paid_orders += 1
        elif order.status == "cancelled":
            cancelled_orders += 1
        for item in order.items:
            product = catalog.get(item.sku)
            if product is None:
                continue
            amount = product.price * item.quantity
            product_sales[item.sku] = product_sales.get(item.sku, 0) + item.quantity
            customer_totals[order.customer_id] = (
                customer_totals.get(order.customer_id, 0.0) + amount
            )
            total_revenue += amount
    lines.append(f"orders: {total_orders}")
    lines.append(f"paid: {paid_orders}")
    lines.append(f"cancelled: {cancelled_orders}")
    lines.append(f"revenue: {total_revenue:.2f}")
    if total_orders > 0:
        average = total_revenue / total_orders
        lines.append(f"average order: {average:.2f}")
    else:
        lines.append("average order: n/a")
    lines.append("top products:")
    ranked = sorted(product_sales.items(), key=lambda kv: kv[1], reverse=True)
    for sku, qty in ranked:
        lines.append(f"  {sku}: {qty}")
    lines.append("top customers:")
    ranked_customers = sorted(
        customer_totals.items(), key=lambda kv: kv[1], reverse=True
    )
    for customer_id, amount in ranked_customers:
        lines.append(f"  {customer_id}: {amount:.2f}")
    lines.append("low stock:")
    for sku, qty in product_sales.items():
        product = catalog.get(sku)
        if product is not None and product.stock < 10:
            lines.append(f"  {sku}: {product.stock}")
    summary = {
        "orders": total_orders,
        "paid": paid_orders,
        "cancelled": cancelled_orders,
        "revenue": total_revenue,
        "product_sales": product_sales,
    }
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
        handle.write("\n")
        handle.write(json.dumps(summary))
    subject = "Daily sales report"
    body = "\n".join(lines)
    send_email(email_to, subject, body)
    return output_path
