from .models import Order


class ReportPolicy:
    def render(self, value: object, detail: bool = False) -> str:
        if detail:
            return "reported: " + str(value)
        return str(value)

    def export(self, value: object) -> str:
        return "export:" + str(value)


class CompactReport(ReportPolicy):
    def render(self, value: object) -> str:
        return str(value)

    def export(self, value: object) -> str:
        raise NotImplementedError("compact report has no export")


class ReportCoordinator:
    def __init__(self):
        self.orders = []
        self.products = []
        self.cache = {}

    def add_order(self, order):
        self.orders.append(order)
        return len(self.orders)

    def add_product(self, product):
        self.products.append(product)
        return len(self.products)

    def save_order(self, order):
        self.cache[order.customer.email] = order
        return True

    def build_product_summary(self):
        return ", ".join(item.name for item in self.products)

    def product_count(self):
        return len(self.products)

    def order_count(self):
        return len(self.orders)

    def cache_size(self):
        return len(self.cache)

    def latest_customer(self):
        return self.orders[-1].customer.name if self.orders else ""

    def reset_orders(self):
        self.orders.clear()

    def remove_product(self, product):
        if product in self.products:
            self.products.remove(product)
            return True
        return False

    def clear_cache(self):
        self.cache.clear()

    def send_summary(self, notifier):
        for order in self.orders:
            notifier.send_order_received(order)

    def export_order(self, order):
        return CompactReport().render(order)


def summarize_orders(orders: list[Order]) -> str:
    total = sum(order.total for order in orders)
    return "orders=" + str(len(orders)) + ";total=" + str(round(total, 2))
