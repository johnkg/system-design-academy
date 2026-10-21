# Charging a card exactly once in Python:
# an idempotency key makes retries safe, and every successful charge is recorded as two balanced ledger entries.
import sys
from dataclasses import dataclass

MAX_ATTEMPTS = 3  # calls to the provider before the payment is marked unknown
REQUESTS = 3      # the same request arrives three times


class PaymentTimeoutError(Exception):
    pass


@dataclass
class Charge:
    id: str
    amount_cents: int


@dataclass
class Payment:
    id: str
    state: str
    amount_cents: int
    charge_id: str | None = None


# A pretend payment provider. Like real ones it remembers the key of each charge, and its reply can be lost after the money moved.
class Provider:
    def __init__(self):
        self.charges: dict[str, Charge] = {}
        self.lose_next_reply = True

    def charge(self, key, amount_cents):
        if key not in self.charges:
            self.charges[key] = Charge(f"ch_{len(self.charges) + 1}", amount_cents)
        if self.lose_next_reply:
            self.lose_next_reply = False
            raise PaymentTimeoutError("no reply")  # the charge happened, the answer did not arrive
        return self.charges[key]


class PaymentService:
    def __init__(self, provider):
        self.provider = provider
        self.payments: dict[str, Payment] = {}
        self.ledger: list[dict] = []

    def pay(self, key, amount_cents):
        existing = self.payments.get(key)
        if existing and existing.state == "succeeded":
            return existing  # a repeat of a finished request: same answer, no new charge
        payment = existing or Payment(f"pay_{len(self.payments) + 1}", "processing", amount_cents)
        self.payments[key] = payment  # saved BEFORE calling the provider, so a crash leaves a trace
        for _ in range(MAX_ATTEMPTS):
            try:
                charge = self.provider.charge(key, amount_cents)  # the same key on every attempt
                payment.state = "succeeded"
                payment.charge_id = charge.id
                self.post(payment)  # two entries that cancel out, written together
                return payment
            except PaymentTimeoutError:
                pass  # anything else is a real failure and propagates; only a timeout is worth retrying
        payment.state = "unknown"  # never guess: a webhook or a status check settles it later
        return payment

    def post(self, payment):
        self.ledger.append({"payment": payment.id, "account": "provider_receivable", "debit": payment.amount_cents, "credit": 0})
        self.ledger.append({"payment": payment.id, "account": "revenue", "debit": 0, "credit": payment.amount_cents})


provider = Provider()
service = PaymentService(provider)

# The shopper's browser sends the same request three times (a timeout, then two double-clicks) with one key.
results = [service.pay("order-81-attempt-1", 2599) for _ in range(REQUESTS)]

debits = sum(e["debit"] for e in service.ledger)
credits = sum(e["credit"] for e in service.ledger)
print(f"requests: 3   payments created: {len(service.payments)}   provider charges: {len(provider.charges)}")
print(f"results: {', '.join(f'{r.id} {r.state}' for r in results)}")
print(f"ledger entries: {len(service.ledger)}   debits {debits}   credits {credits}")
if len(provider.charges) != 1 or len(service.payments) != 1 or len(service.ledger) != 2 or debits != credits:
    sys.exit(1)
