# Strategy in Python. A strategy is just a function: (total) -> new_total.
from __future__ import annotations

from typing import Callable

Strategy = Callable[[float], float]


def regular_price(total: float) -> float:  # Concrete Strategy
    return total


def percent_off(percent: float) -> Strategy:  # Concrete Strategy
    return lambda total: total * (1 - percent / 100)


def flat_off(amount: float) -> Strategy:  # Concrete Strategy
    return lambda total: max(0, total - amount)


def show(x: float) -> str:  # print whole numbers without ".0", like JS
    return str(int(x)) if float(x).is_integer() else str(x)


class Checkout:  # Context
    def __init__(self, strategy: Strategy = regular_price):
        self._strategy = strategy

    def set_strategy(self, strategy: Strategy) -> None:  # swap at runtime
        self._strategy = strategy

    def total(self, prices: list[float]) -> float:
        total = sum(prices)
        return self._strategy(total)  # delegate; Checkout never knows which rule runs


cart = [30, 20]
checkout = Checkout()
print(show(checkout.total(cart)))        # 50

checkout.set_strategy(percent_off(20))
print(show(checkout.total(cart)))        # 40

checkout.set_strategy(flat_off(15))
print(show(checkout.total(cart)))        # 35
