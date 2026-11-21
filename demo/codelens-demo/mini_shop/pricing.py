from abc import ABC, abstractmethod

from .models import CustomerTier, Product


class DiscountPolicy(ABC):
    @abstractmethod
    def price_for(self, product: Product) -> float:
        raise NotImplementedError


class StandardDiscount(DiscountPolicy):
    def price_for(self, product: Product) -> float:
        return round(product.price, 2)


class VipDiscount(DiscountPolicy):
    def price_for(self, product: Product) -> float:
        return round(product.price * 0.9, 2)


class PricingService:
    def __init__(self):
        self.standard = StandardDiscount()
        self.vip = VipDiscount()

    def price_for(self, product: Product, tier: CustomerTier) -> float:
        if tier is CustomerTier.VIP:
            return self.vip.price_for(product)
        return self.standard.price_for(product)
