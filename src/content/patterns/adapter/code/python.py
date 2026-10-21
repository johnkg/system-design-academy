# Adapter in Python. The adapter speaks pay(dollars) and translates for the legacy API.
import math
from dataclasses import dataclass

CENTS_PER_DOLLAR = 100


class CardGateway:  # Target implementation: already speaks pay(dollars)
    def pay(self, dollars):
        return f"Card charged ${dollars:.2f}"


@dataclass
class PaymentResult:
    ok: bool
    ref: str


class LegacyBankApi:  # Adaptee: third-party, cannot be changed
    def make_payment(self, cents, currency):
        return PaymentResult(ok=True, ref=f"LB-{cents}{currency}")


class LegacyBankAdapter:  # Adapter
    def __init__(self, bank):
        self._bank = bank

    def pay(self, dollars):
        cents = math.floor(dollars * CENTS_PER_DOLLAR + 0.5)  # translate units
        result = self._bank.make_payment(cents, "USD")      # translate the call
        if result.ok:                                       # translate the result
            return f"Paid ${dollars:.2f} (ref {result.ref})"
        return "Payment failed"


def checkout(gateway, amount):  # Client: only knows pay(dollars)
    print(gateway.pay(amount))


checkout(CardGateway(), 25)
checkout(LegacyBankAdapter(LegacyBankApi()), 25)
