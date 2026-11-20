# The life of one card payment: authorize (a hold), capture (the charge, maybe partial), void, expiry, settlement, refund.
# Integer cents and whole days, a fixed script, so the output never changes. Fees and delays are illustrative settings.
OPENING_AVAILABLE = 50000  # the cardholder's available balance before the order, in cents
EXPIRY_DAYS = 7            # an uncaptured hold is released after this many days
SETTLE_DAYS = 2            # captured money reaches the merchant this many days after the capture
FEE_BP = 290               # merchant fee: 2.90% of each capture, in basis points ...
FEE_FIXED = 30             # ... plus 30 cents per capture


def div_round_up(num, den):
    """Half up, integers only."""
    q = num // den
    return q + 1 if 2 * (num - q * den) >= den else q


class Payment:
    def __init__(self):
        self.day = 0
        self.available = OPENING_AVAILABLE
        self.held = self.captured = self.refunded = self.fees = self.pending = self.settled = 0
        self.auth_day = -1
        self.ended = ""
        self.ended_day = -1
        self.due = []  # [day, net] of captured money still on its way to the merchant

    def authorize(self, amount):
        if self.auth_day >= 0:
            return False, "rejected: an authorization already exists for this order"
        if self.available < amount:
            return False, f"rejected: the card has {self.available} available, {amount} needed"
        self.available -= amount
        self.held = amount
        self.auth_day = self.day
        return True, f"hold of {amount} placed, nothing charged yet"

    def capture(self, amount):
        if self.auth_day < 0:
            return False, "rejected: there is no authorization to capture"
        if self.ended == "expired":
            return False, f"rejected: the hold expired on day {self.ended_day}"
        if self.ended == "voided":
            return False, f"rejected: the authorization was voided on day {self.ended_day}"
        if amount > self.held:
            return False, f"rejected: capture of {amount} is above the {self.held} still held"
        fee = div_round_up(amount * FEE_BP, 10000) + FEE_FIXED
        self.held -= amount
        self.captured += amount
        self.fees += fee
        self.pending += amount - fee
        self.due.append([self.day + SETTLE_DAYS, amount - fee])
        return True, f"captured {amount}, fee {fee}, merchant will receive {amount - fee} on day {self.day + SETTLE_DAYS}"

    def void(self):
        if self.held == 0:
            return False, "rejected: there is no hold left to release"
        released = self.held
        self.available += released
        self.held = 0
        self.ended = "voided"
        self.ended_day = self.day
        return True, f"released the hold of {released}"

    def refund(self, amount):
        left = self.captured - self.refunded
        if amount > left:
            return False, f"rejected: refund of {amount} is above the {left} captured and not yet refunded"
        self.refunded += amount
        self.available += amount
        return True, f"refunded {amount} to the cardholder"

    def advance(self):
        self.day += 1
        notes = []
        for d in self.due:
            if d[1] > 0 and d[0] <= self.day:
                self.pending -= d[1]
                self.settled += d[1]
                notes.append(f"settled {d[1]} to the merchant")
                d[1] = 0
        if self.held > 0 and self.day - self.auth_day >= EXPIRY_DAYS:
            self.available += self.held
            notes.append(f"hold expired, {self.held} released")
            self.held = 0
            self.ended = "expired"
            self.ended_day = self.day
        return True, f"day {self.day}" + (": " + "; ".join(notes) if notes else "")

    def show(self):
        return (f"  available {self.available}, held {self.held}, captured {self.captured}, refunded {self.refunded}, "
                f"fees {self.fees}, merchant pending {self.pending}, settled {self.settled}")


def story(title, steps):
    print(f"-- {title}")
    p = Payment()
    for label, fn in steps:
        _, text = fn(p)
        print(f"day {p.day} {label}: {text}")
    print(p.show())


story("authorize, capture in full, settle, refund", [
    ("authorize 10000", lambda p: p.authorize(10000)),
    ("advance", lambda p: p.advance()),
    ("capture 10000", lambda p: p.capture(10000)),
    ("advance", lambda p: p.advance()),
    ("advance", lambda p: p.advance()),
    ("refund 2500", lambda p: p.refund(2500)),
    ("refund 10000", lambda p: p.refund(10000)),
])

story("partial capture, then the rest of the hold expires", [
    ("authorize 10000", lambda p: p.authorize(10000)),
    ("capture 4000", lambda p: p.capture(4000)),
    *[("advance", lambda p: p.advance()) for _ in range(EXPIRY_DAYS)],
    ("capture 6000", lambda p: p.capture(6000)),
])

story("void an authorization", [
    ("authorize 10000", lambda p: p.authorize(10000)),
    ("void", lambda p: p.void()),
    ("capture 10000", lambda p: p.capture(10000)),
    ("void", lambda p: p.void()),
])
