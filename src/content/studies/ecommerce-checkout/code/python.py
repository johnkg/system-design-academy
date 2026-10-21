# Inventory reservations and an order saga, in Python:
# stock is taken with a hold that expires, an order is placed once per idempotency key,
# failures are undone in reverse order, and every status change is also written to an outbox.
import sys

STOCK, TTL, BUYERS, PER_TICK = 30, 3, 80, 10
SEED, TICKS = 11, 12
AFTER_ALL_HOLDS = 99  # a time when every hold has expired
# Buyer behaviour, in percent: who never pays, gets declined, has shipping fail, or double-clicks.
NO_PAY_PERCENT, DECLINE_PERCENT, SHIP_FAIL_PERCENT, DOUBLE_CLICK_PERCENT = 30, 15, 10, 20
PAY_DELAYS = 5  # a buyer pays 0..4 ticks after reserving
RELAY_CRASH_PERCENT = 10
seed = SEED


def random(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


class Inventory:
    def __init__(self, stock):
        self.available = stock
        self.holds = {}  # order id -> {"qty", "expires"}

    def reserve(self, order_id, qty, expires):
        if order_id in self.holds:
            return True       # the same request again: already reserved
        if self.available < qty:
            return False      # the conditional decrement: never below zero
        self.available -= qty
        self.holds[order_id] = {"qty": qty, "expires": expires}
        return True

    def commit(self, order_id):  # the stock stays taken, and the hold is used up
        self.holds.pop(order_id, None)

    def release(self, order_id):
        h = self.holds.pop(order_id, None)
        if h:
            self.available += h["qty"]

    def restock(self, qty):
        self.available += qty

    def expire(self, now):  # give back every hold whose time ran out
        gone = [id for id, h in self.holds.items() if h["expires"] <= now]
        for id in gone:
            self.release(id)
        return gone


buyers = []
for i in range(BUYERS):
    b = {"key": f"k{i}", "tick": i // PER_TICK}
    b["pays"] = random(100) >= NO_PAY_PERCENT
    b["declined"] = random(100) < DECLINE_PERCENT
    b["delay"] = random(PAY_DELAYS)
    b["ship_fails"] = random(100) < SHIP_FAIL_PERCENT
    b["double"] = random(100) < DOUBLE_CLICK_PERCENT
    buyers.append(b)

inv = Inventory(STOCK)
orders, by_id, outbox = {}, {}, []
n = {"duplicates": 0, "charged": 0, "refunded": 0, "late_lost": 0}


def set_status(order, status):  # the status and its event are written together, as one transaction
    order["status"] = status
    outbox.append({"id": len(outbox) + 1, "type": f"order.{status.lower()}", "sent": False})


def place(key):  # idempotent: one order per key, however many times the button is pressed
    if key in orders:
        n["duplicates"] += 1
        return orders[key]
    order = {"id": len(orders) + 1, "key": key}
    orders[key] = order
    by_id[order["id"]] = order
    set_status(order, "PENDING")
    return order


def pay(order, b, now):  # the saga: reserve (done) -> charge -> ship, and undo in reverse order on failure
    if order["status"] == "EXPIRED" and not inv.reserve(order["id"], 1, now + TTL):
        set_status(order, "SOLD_OUT")
        n["late_lost"] += 1
        return
    if b["declined"]:  # undo: release the hold
        inv.release(order["id"])
        set_status(order, "DECLINED")
        return
    n["charged"] += 1
    inv.commit(order["id"])
    if b["ship_fails"]:  # undo: refund, then restock
        n["refunded"] += 1
        inv.restock(1)
        set_status(order, "CANCELLED")
        return
    set_status(order, "CONFIRMED")


waiting = []
for t in range(TICKS):
    for id in inv.expire(t):
        set_status(by_id[id], "EXPIRED")
    for b in [x for x in buyers if x["tick"] == t]:
        order = place(b["key"])
        if b["double"]:
            place(b["key"])  # a double click
        if not inv.reserve(order["id"], 1, t + TTL):
            set_status(order, "SOLD_OUT")
        elif b["pays"]:
            waiting.append({"order": order, "b": b, "due": t + b["delay"]})
    for w in [w for w in waiting if w["due"] == t]:
        pay(w["order"], w["b"], t)
for id in inv.expire(AFTER_ALL_HOLDS):  # the buyers who never paid
    set_status(by_id[id], "EXPIRED")

bus = []
while True:  # the relay: publish unsent rows, and sometimes crash before marking one as sent
    crashed = False
    for row in outbox:
        if row["sent"]:
            continue
        bus.append(row["id"])
        if random(100) < RELAY_CRASH_PERCENT:
            crashed = True
            break
        row["sent"] = True
    if not crashed:
        break


def count(s):
    return sum(1 for o in orders.values() if o["status"] == s)


confirmed = count("CONFIRMED")
print(f"orders {len(orders)}: confirmed {confirmed}, sold out {count('SOLD_OUT')}, declined {count('DECLINED')}, expired {count('EXPIRED')}, cancelled {count('CANCELLED')}")
print(f"late payers who lost their stock {n['late_lost']}, double clicks absorbed {n['duplicates']}")
print(f"stock {STOCK} = available {inv.available} + sold {confirmed}; charged {n['charged']}, refunded {n['refunded']}")
print(f"outbox rows {len(outbox)}, bus deliveries {len(bus)}, redelivered {len(bus) - len(outbox)}, applied once {len(set(bus))}")

ok = (confirmed <= STOCK and inv.available + confirmed == STOCK and len(inv.holds) == 0
      and n["charged"] - n["refunded"] == confirmed and len(set(bus)) == len(outbox))
if not ok:
    sys.exit(1)
