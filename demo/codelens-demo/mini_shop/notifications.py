from typing import TYPE_CHECKING

from .models import Order

if TYPE_CHECKING:
    from .orders import OrderService


class Notifier:
    def send_order_received(self, order: Order) -> None:
        print("邮件通知：" + order.customer.email)

    def send_low_stock_alert(self, product_name: str) -> None:
        print("库存提醒：" + product_name)


def preview_notification(service: "OrderService", order: Order) -> str:
    return service.notification_text(order)
