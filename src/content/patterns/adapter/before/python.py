# Without the pattern: checkout knows every vendor's API and units.
import math
from dataclasses import dataclass

CENTS_PER_DOLLAR = 100


class CardGateway:
    def pay(self, dollars):
        return f"Card charged ${dollars:.2f}"


@dataclass
class PaymentResult:
    ok: bool
    ref: str


class LegacyBankApi:
    def make_payment(self, cents, currency):
        return PaymentResult(ok=True, ref=f"LB-{cents}{currency}")


def checkout(provider, amount):
    if provider == "card":
        print(CardGateway().pay(amount))
    elif provider == "legacy":
        # Unit conversion and result handling copied wherever the bank is used.
        result = LegacyBankApi().make_payment(math.floor(amount * CENTS_PER_DOLLAR + 0.5), "USD")
        print(f"Paid ${amount:.2f} (ref {result.ref})" if result.ok else "Payment failed")
    # Another provider? Another branch, with its own units and quirks.


checkout("card", 25)
checkout("legacy", 25)
