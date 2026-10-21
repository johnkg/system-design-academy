# Stock as a ledger of movements, in Python:
# the balance is the sum of the movements, a reservation holds units until it expires or is paid,
# and a reservation is only granted if balance minus holds still covers it.
import sys

TTL = 10  # a hold lasts 10 ticks


class Inventory:
    def __init__(self, warehouses):
        self.ledger = []                      # append-only: (wh, delta, kind, ref)
        self.balance = [0] * warehouses       # projection: the sum of the ledger per warehouse
        self.held = [0] * warehouses          # units promised to active reservations
        self.reservations = {}                # id -> dict(wh, qty, expires, state)
        self.min_available = 0

    def move(self, wh, delta, kind, ref):
        self.ledger.append((wh, delta, kind, ref))
        self.balance[wh] += delta

    def available(self, wh):
        return self.balance[wh] - self.held[wh]

    def reserve(self, rid, qty, now):
        if rid in self.reservations:
            return True                       # a retry of the same request changes nothing
        wh = next((w for w in range(len(self.balance)) if self.available(w) >= qty), -1)
        if wh < 0:
            return False                      # the check and the hold are one step
        self.held[wh] += qty
        self.reservations[rid] = {"wh": wh, "qty": qty, "expires": now + TTL, "state": "held"}
        self.min_available = min([self.min_available] + [self.available(w) for w in range(len(self.balance))])
        return True

    def expire(self, now):
        n = 0
        for r in self.reservations.values():
            if r["state"] == "held" and r["expires"] <= now:
                r["state"] = "expired"
                self.held[r["wh"]] -= r["qty"]
                n += 1
        return n

    def commit(self, rid, now):
        r = self.reservations.get(rid)
        if r is None or r["state"] != "held" or now >= r["expires"]:
            return False                      # too late: the units went back on sale
        r["state"] = "sold"
        self.held[r["wh"]] -= r["qty"]
        self.move(r["wh"], -r["qty"], "pick", rid)
        return True


SEED = 7
STOCK_A = 60  # opening stock in warehouses 0 and 1
STOCK_B = 40
TICKS = 200
RESTOCK_AT = 100  # a delivery to warehouse 1
RESTOCK_QTY = 150
MAX_REQUESTS = 3  # 1..3 reservation requests per tick
MAX_QTY = 3  # 1..3 units each
PAY_PCT = 65  # reservations that are paid
MAX_PAY_DELAY = 14  # paid 1..14 ticks after the hold
SHRINKAGE = 3  # units lost without a record

seed = SEED


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


inv = Inventory(2)
inv.move(0, STOCK_A, "receipt", "po-1")
inv.move(1, STOCK_B, "receipt", "po-2")
physical = [STOCK_A, STOCK_B]                        # what is really on the shelves
nxt = rejected = accepted = sold = expired = late = 0
pending = []                                  # (id, pay_at)
for now in range(TICKS):
    expired += inv.expire(now)
    if now == RESTOCK_AT:
        inv.move(1, RESTOCK_QTY, "receipt", "po-3")
        physical[1] += RESTOCK_QTY                   # a delivery arrives
    for _ in range(1 + rnd(MAX_REQUESTS)):
        rid, qty = "r" + str(nxt), 1 + rnd(MAX_QTY)
        nxt += 1
        if inv.reserve(rid, qty, now):
            accepted += 1
            if rnd(100) < PAY_PCT:
                pending.append((rid, now + 1 + rnd(MAX_PAY_DELAY)))
        else:
            rejected += 1
    for rid, pay_at in [p for p in pending if p[1] == now]:
        r = inv.reservations[rid]
        if inv.commit(rid, now):
            sold += r["qty"]
            physical[r["wh"]] -= r["qty"]
        else:
            late += 1
inv.reserve("r0", 1, TICKS)                     # replay of an old id: no new hold
physical[1] -= SHRINKAGE                             # three units were damaged or stolen, and nobody recorded it

print(f"requests {nxt}: accepted {accepted}, rejected {rejected}")
print(f"units sold {sold}, holds expired {expired}, payments refused as late {late}")
print(f"lowest available ever: {inv.min_available}")
for w in range(2):
    print(f"warehouse {w}: balance {inv.balance[w]}, held {inv.held[w]}, shelf {physical[w]}")
for w in range(2):
    diff = physical[w] - inv.balance[w]
    if diff != 0:
        inv.move(w, diff, "count", "cc-1")
    print(f"cycle count warehouse {w}: adjustment {diff}")
replay = [0, 0]
for wh, delta, _, _ in inv.ledger:
    replay[wh] += delta
ok = all(v == inv.balance[w] and v == physical[w] for w, v in enumerate(replay))
print(f"ledger entries {len(inv.ledger)}; replay matches balances and shelves: {str(ok).lower()}")
if inv.min_available < 0 or not ok:
    sys.exit(1)
