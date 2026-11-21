from .models import Customer, CustomerTier, Order, OrderLine, Product
from .notifications import Notifier
from .pricing import PricingService


class InventoryService:
    def __init__(self):
        self.stock = {
            "BOOK": 8,
            "MUG": 3,
            "PEN": 20,
        }

    def available(self, product: Product) -> int:
        return self.stock.get(product.sku, 0)

    def reserve(self, product: Product, quantity: int) -> bool:
        available = self.available(product)
        if quantity <= 0:
            return False
        if available < quantity:
            return False
        self.stock[product.sku] = available - quantity
        return True


class OrderService:
    def __init__(self):
        self.inventory = InventoryService()
        self.pricing = PricingService()
        self.notifier = Notifier()

    def notification_text(self, order: Order) -> str:
        return "订单已接收：" + order.customer.name

    def describe_types(
        self,
        tier: CustomerTier,
        customer: Customer,
        product: Product,
    ) -> str:
        parts = []
        if isinstance(tier, CustomerTier):
            parts.append("会员等级")
        if isinstance(customer, Customer):
            parts.append(customer.name)
        if isinstance(product, Product):
            parts.append(product.name)
        return " / ".join(parts)

    def place_order(
        self,
        customer: Customer,
        products: list[Product],
        quantity: int,
        channel: str,
        coupon: str = "",
        expedited: bool = False,
    ) -> Order:
        order = Order(customer=customer)
        subtotal = 0.0
        for product in products:
            if product is not None:
                if quantity > 0:
                    if self.inventory.available(product) > 0:
                        if self.inventory.reserve(product, quantity):
                            unit_price = self.pricing.price_for(product, customer.tier)
                            line_total = unit_price * quantity
                            if expedited:
                                if channel == "web":
                                    line_total += 4
                                elif channel == "mobile":
                                    line_total += 2
                                else:
                                    line_total += 6
                            if coupon == "SAVE10":
                                line_total = line_total - 10
                            elif coupon == "SAVE5":
                                line_total = line_total - 5
                            elif coupon.startswith("VIP"):
                                line_total = line_total * 0.95
                            elif coupon == "":
                                line_total = line_total
                            else:
                                line_total = line_total - 1
                            if line_total < 0:
                                line_total = 0
                            order.lines.append(OrderLine(product, quantity))
                            subtotal += line_total
            if product is not None and self.inventory.available(product) <= 1:
                self.notifier.send_low_stock_alert(product.name)
        if subtotal > 500:
            subtotal = subtotal * 0.98
        elif subtotal > 200:
            subtotal = subtotal - 5
        else:
            subtotal = subtotal + 0
        order.total = round(subtotal, 2)
        handle = open("orders.log", "a", encoding="utf-8")
        handle.write(customer.name + ":" + str(order.total) + "\n")
        handle.close()
        self.notifier.send_order_received(order)
        return order
