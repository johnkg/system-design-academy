# A hotel booking core in Python: one inventory row per room type and night, an all-or-nothing conditional update across the nights of a stay,
# holds that expire, idempotent requests, and a small overbooking allowance.
import sys

NIGHTS, CAPACITY, OVERBOOK, HOLD_TTL = 7, 10, 1, 6  # 10 rooms of one type, one extra allowed, holds last 6 ticks


class Inventory:
    def __init__(self, limit):
        self.limit = limit
        self.rows = [{"sold": 0, "held": 0} for _ in range(NIGHTS)]  # one row per night
        self.holds = {}  # idempotency key -> hold
        self.replays = 0

    # UPDATE row SET held = held + 1 WHERE night = ? AND sold + held < limit, for each night. If any night fails, undo the ones that worked.
    def hold(self, key, from_night, to_night, now):
        if key in self.holds:  # same key again: return the same answer
            self.replays += 1
            return self.holds[key]
        done = []
        for n in range(from_night, to_night):
            row = self.rows[n]
            if row["sold"] + row["held"] >= self.limit:
                for d in done:
                    self.rows[d]["held"] -= 1
                return self.remember(key, {"state": "rejected"})
            row["held"] += 1
            done.append(n)
        return self.remember(key, {"state": "held", "from": from_night, "to": to_night, "expires": now + HOLD_TTL})

    def remember(self, key, hold):
        self.holds[key] = hold
        return hold

    def confirm(self, key, now):  # payment succeeded
        h = self.holds.get(key)
        if not h or h["state"] != "held" or now >= h["expires"]:  # a late payment finds the hold gone
            return False
        for n in range(h["from"], h["to"]):
            self.rows[n]["held"] -= 1
            self.rows[n]["sold"] += 1
        h["state"] = "sold"
        return True

    def expire(self, now):  # a sweeper gives back holds whose time ran out
        freed = 0
        for h in self.holds.values():
            if h["state"] == "held" and now >= h["expires"]:
                for n in range(h["from"], h["to"]):
                    self.rows[n]["held"] -= 1
                h["state"] = "expired"
                freed += 1
        return freed


SEED = 4242
REQUESTS = 60  # one booking request per tick
MAX_STAY = 3  # nights per request: 1..3
PAY_PCT = 70  # requests that go on to pay
PAY_DELAY = 2  # ticks between hold and payment
RETRY_EVERY = 7  # every 7th request is sent twice
SNAPSHOT_GROUP = 12  # requests that read the same snapshot in the naive version
NO_SHOW_STEPS = 3  # 0%, 10% or 20% no-shows, by night
TENTHS = 10

seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# 60 requests, one per tick. Each wants 1 to 3 nights, pays 2 ticks later unless it abandons, and every 7th request is sent twice.
requests = []
for i in range(REQUESTS):
    length = 1 + random(MAX_STAY)
    start = random(NIGHTS - length + 1)
    requests.append({"key": f"req-{i}", "from": start, "to": start + length, "pays": random(100) < PAY_PCT})

# The mistake: everyone reads the free count first, then writes. Here 12 requests read the same snapshot.
naive = [0] * NIGHTS
for i in range(0, len(requests), SNAPSHOT_GROUP):
    snapshot = naive[:]
    for r in requests[i:i + SNAPSHOT_GROUP]:
        free = True
        for n in range(r["from"], r["to"]):
            if snapshot[n] >= CAPACITY:
                free = False
        if free:
            for n in range(r["from"], r["to"]):
                naive[n] += 1
naive_over = sum(max(0, x - CAPACITY) for x in naive)

inv = Inventory(CAPACITY + OVERBOOK)
pending = []
rejected = sold = expired = 0
for t in range(len(requests) + HOLD_TTL + PAY_DELAY):
    expired += inv.expire(t)
    for p in [p for p in pending if p["at"] == t]:
        if inv.confirm(p["key"], t):
            sold += 1
    r = requests[t] if t < len(requests) else None
    if r:
        h = inv.hold(r["key"], r["from"], r["to"], t)
        if h["state"] == "rejected":
            rejected += 1
        elif r["pays"]:
            pending.append({"key": r["key"], "at": t + PAY_DELAY})
        if t % RETRY_EVERY == 0:
            inv.hold(r["key"], r["from"], r["to"], t)  # a client retry with the same key

usage = [row["sold"] + row["held"] for row in inv.rows]
print(f"read then write: nights sold beyond {CAPACITY} rooms = {naive_over}")
print(f"conditional update: sold {sold}, rejected {rejected}, holds expired {expired}, retries replayed {inv.replays}")
print(f"rooms used per night: {' '.join(str(u) for u in usage)} (limit {CAPACITY + OVERBOOK})")

# Overbooking: guests who cancel or do not show up leave rooms empty, and the allowance sells them twice.
sold10 = [row["sold"] for row in inv.rows]
# Pretend that 0%, 10% or 20% of the guests booked for a night do not arrive, depending on the night.
shown = [(s * (TENTHS - (i % NO_SHOW_STEPS)) + TENTHS // 2) // TENTHS for i, s in enumerate(sold10)]
walked = sum(max(0, x - CAPACITY) for x in shown)
print(f"sold per night: {' '.join(str(s) for s in sold10)}; guests who arrive: {' '.join(str(s) for s in shown)}; guests without a room: {walked}")

if naive_over == 0:
    sys.exit(1)
if any(u > CAPACITY + OVERBOOK for u in usage):
    sys.exit(1)
if any(row["held"] != 0 for row in inv.rows):
    sys.exit(1)  # every hold ended as sold or expired
