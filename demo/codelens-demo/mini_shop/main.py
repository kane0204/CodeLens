from .models import Customer, CustomerTier, Product
from .orders import OrderService
from .reporting import ReportCoordinator, summarize_orders


def run_demo():
    customer = Customer(
        name="演示用户",
        email="demo@example.com",
        tier=CustomerTier.VIP,
    )
    products = [
        Product("BOOK", "CodeLens 手册", 39.0, 5),
        Product("MUG", "调试马克杯", 25.0, 2),
    ]
    service = OrderService()
    order = service.place_order(
        customer=customer,
        products=products,
        quantity=2,
        channel="web",
        coupon="SAVE10",
        expedited=True,
    )
    service.describe_types(customer.tier, customer, products[0])
    report = ReportCoordinator()
    report.add_order(order)
    report.add_product(products[0])
    report.save_order(order)
    report.product_count()
    report.order_count()
    report.cache_size()
    report.latest_customer()
    report.build_product_summary()
    report.send_summary(service.notifier)
    return summarize_orders([order])


if __name__ == "__main__":
    print(run_demo())
