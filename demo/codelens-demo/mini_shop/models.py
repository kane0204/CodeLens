from dataclasses import dataclass, field
from enum import Enum


class CustomerTier(Enum):
    STANDARD = "standard"
    VIP = "vip"


@dataclass
class Product:
    sku: str
    name: str
    price: float
    stock: int = 0


@dataclass
class Customer:
    name: str
    email: str
    tier: CustomerTier = CustomerTier.STANDARD


@dataclass
class OrderLine:
    product: Product
    quantity: int


@dataclass
class Order:
    customer: Customer
    lines: list[OrderLine] = field(default_factory=list)
    total: float = 0.0
