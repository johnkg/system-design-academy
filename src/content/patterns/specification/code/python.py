# Specification in Python. A rule is an object that can be combined with &, | and ~.
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass
class Customer:
    name: str
    active: bool
    blocked: bool
    total: int


class Spec:
    def __and__(self, other: Spec) -> Spec:
        return And(self, other)

    def __or__(self, other: Spec) -> Spec:
        return Or(self, other)

    def __invert__(self) -> Spec:
        return Not(self)


class Leaf(Spec):  # Leaf specification: one simple condition
    def __init__(self, text: str, test: Callable[[Customer], bool]) -> None:
        self.text, self.test = text, test

    def is_satisfied_by(self, c: Customer) -> bool:
        return self.test(c)

    def describe(self) -> str:
        return self.text


class And(Spec):  # Composite specification
    def __init__(self, left: Spec, right: Spec) -> None:
        self.left, self.right = left, right

    def is_satisfied_by(self, c: Customer) -> bool:
        return self.left.is_satisfied_by(c) and self.right.is_satisfied_by(c)

    def describe(self) -> str:
        return f"({self.left.describe()} AND {self.right.describe()})"


class Or(Spec):
    def __init__(self, left: Spec, right: Spec) -> None:
        self.left, self.right = left, right

    def is_satisfied_by(self, c: Customer) -> bool:
        return self.left.is_satisfied_by(c) or self.right.is_satisfied_by(c)

    def describe(self) -> str:
        return f"({self.left.describe()} OR {self.right.describe()})"


class Not(Spec):
    def __init__(self, inner: Spec) -> None:
        self.inner = inner

    def is_satisfied_by(self, c: Customer) -> bool:
        return not self.inner.is_satisfied_by(c)

    def describe(self) -> str:
        return f"NOT {self.inner.describe()}"


active = Leaf("active", lambda c: c.active)
blocked = Leaf("blocked", lambda c: c.blocked)


def total_at_least(n: int) -> Leaf:
    return Leaf(f"total >= {n}", lambda c: c.total >= n)


customers = [
    Customer("ada", True, False, 120),
    Customer("bob", True, True, 200),
    Customer("cy", False, False, 150),
    Customer("dee", True, False, 60),
]


def report(title: str, rule: Spec) -> None:
    yes = [c.name for c in customers if rule.is_satisfied_by(c)]
    no = [c.name for c in customers if not rule.is_satisfied_by(c)]
    print(f"{title}: {rule.describe()}")
    print(f"  Eligible: {', '.join(yes)}")
    print(f"  Not eligible: {', '.join(no)}")


report("Discount rule", active & ~blocked & total_at_least(100))
report("Login rule", active & ~blocked)
