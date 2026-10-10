# Chain of Responsibility in Python. Each approver handles or passes on.
from __future__ import annotations

import math


class Approver:  # Handler
    def __init__(self, name, limit):
        self.name = name
        self.limit = limit
        self._next = None

    def set_next(self, next_approver: Approver) -> Approver:  # returns next so calls chain
        self._next = next_approver
        return next_approver

    def approve(self, amount):
        if amount <= self.limit:
            return f"{self.name} approves ${amount}"
        if self._next:
            return self._next.approve(amount)  # pass it on
        return f"No one can approve ${amount}"


manager = Approver("Manager", 1_000)  # Concrete Handlers
director = Approver("Director", 10_000)
ceo = Approver("CEO", math.inf)
manager.set_next(director).set_next(ceo)

print(manager.approve(500))     # Manager approves $500
print(manager.approve(5_000))   # Director approves $5000
print(manager.approve(50_000))  # CEO approves $50000
