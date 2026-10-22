"""A double-entry ledger in Python: immutable entries, balanced lines, idempotent posting, derived balances,
a hot account split in shards, and corrections by reversal. Integer cents; positive is a debit, negative a credit."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Entry:
    seq: int
    key: str
    sig: str
    lines: tuple
    reverses: int


class Ledger:
    def __init__(self):
        self.entries = []        # the journal: append only, never changed
        self.by_key = {}         # idempotency key -> entry
        self.balances = {}       # derived state, updated with each entry

    def post(self, key, lines, reverses=0):
        sig = ",".join(f"{account}:{amount}" for account, amount in lines)
        seen = self.by_key.get(key)
        if seen:  # a retry of something already posted
            if seen.sig != sig:
                raise ValueError("key reused with different lines")
            return seen, True
        if len(lines) < 2 or any(amount == 0 for _, amount in lines):
            raise ValueError("invalid lines")
        if sum(amount for _, amount in lines) != 0:
            raise ValueError("unbalanced")
        entry = Entry(len(self.entries) + 1, key, sig, tuple(lines), reverses)
        self.entries.append(entry)
        self.by_key[key] = entry
        for account, amount in lines:
            self.balances[account] = self.balances.get(account, 0) + amount
        return entry, False

    def reverse(self, seq):
        """A correction is a new entry with every line negated. The original stays in the journal."""
        original = self.entries[seq - 1]
        return self.post(f"rev-{seq}", [(a, -v) for a, v in original.lines], seq)

    def replay(self):
        """Rebuild every balance from the journal alone, to check the derived state."""
        balances = {}
        for e in self.entries:
            for account, amount in e.lines:
                balances[account] = balances.get(account, 0) + amount
        return balances

    def sum_of(self, prefix):
        """A hot account is spread over sub-accounts such as fees#0 .. fees#7."""
        return sum(v for a, v in self.balances.items() if a.startswith(prefix))

SEED = 2024
WALLETS = 4
OPENING_BALANCE = 1000000  # each wallet is funded from the bank
PAYMENTS = 2000
MIN_AMOUNT = 100  # payment amounts are 100..2099
AMOUNT_SPREAD = 2000
FEE_PCT = 3
FEE_SHARDS = 8  # the hot fees account is split over fees#0 .. fees#7
RETRY_EVERY = 13  # every 13th payment is retried by the client
BAD_EVERY = 17  # every 17th has a buggy unbalanced twin
REFUND_EVERY = 29  # every 29th triggers a refund, sent twice

seed = SEED

def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n

ledger = Ledger()
count = {"accepted": 0, "duplicates": 0, "unbalanced": 0, "reversals": 0}


def tally(fn):
    try:
        entry, duplicate = fn()
        count["duplicates" if duplicate else "accepted"] += 1
        return entry, duplicate
    except ValueError as err:
        if str(err) == "unbalanced":
            count["unbalanced"] += 1
            return None
        raise

for w in range(1, WALLETS + 1):
    tally(lambda: ledger.post(f"init-{w}", [("bank", OPENING_BALANCE), (f"wallet-{w}", -OPENING_BALANCE)]))
last = 0
for i in range(PAYMENTS):
    wallet = f"wallet-{1 + random(WALLETS)}"
    amount = MIN_AMOUNT + random(AMOUNT_SPREAD)
    fee = amount * FEE_PCT // 100
    lines = [(wallet, amount), ("merchant", -(amount - fee)), (f"fees#{i % FEE_SHARDS}", -fee)]
    r = tally(lambda: ledger.post(f"pay-{i}", lines))
    if r and not r[1]:
        last = r[0].seq
    if i % RETRY_EVERY == 0:
        tally(lambda: ledger.post(f"pay-{i}", lines))                                    # the client retries
    if i % BAD_EVERY == 0:
        tally(lambda: ledger.post(f"bad-{i}", [(wallet, amount), ("merchant", -amount + 1)]))  # a bug: lines do not balance
    if i % REFUND_EVERY == 0:
        tally(lambda: ledger.reverse(last))
        tally(lambda: ledger.reverse(last))  # refund, sent twice
        count["reversals"] += 1

replayed = ledger.replay()
trial = sum(ledger.balances.values())
fees = [ledger.balances.get(f"fees#{k}", 0) for k in range(FEE_SHARDS)]
print(f"accepted {count['accepted']}, duplicates ignored {count['duplicates']}, rejected unbalanced {count['unbalanced']}, refunds {count['reversals']}")
for a in ["bank", "wallet-1", "wallet-2", "wallet-3", "wallet-4", "merchant"]:
    print(f"{a}: {ledger.balances[a]}")
print(f"fees: {ledger.sum_of('fees#')} over {FEE_SHARDS} shards, each between {-max(fees)} and {-min(fees)} in credits")
matches = replayed == ledger.balances
print(f"trial balance: {trial}; replay matches balances: {'true' if matches else 'false'}")
if trial != 0 or not matches or count["unbalanced"] == 0 or len(ledger.entries) != count["accepted"]:
    raise SystemExit(1)
