"""Data models for the shop domain."""

from dataclasses import dataclass


@dataclass
class Product:
    """A sellable product."""

    sku: str
    name: str
    price: float
    stock: int = 0


@dataclass
class OrderItem:
    """One line of an order."""

    sku: str
    quantity: int


@dataclass
class Order:
    """A customer order."""

    order_id: str
    customer_id: str
    items: list
    status: str = "pending"
    discount: float = 0.0
    total: float = 0.0


@dataclass
class DiscountedOrder(Order):
    """An order created from a coupon campaign."""

    coupon_code: str = ""
