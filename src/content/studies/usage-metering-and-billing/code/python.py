# A usage meter in Python: events arrive out of order and sometimes twice.
# We drop duplicates by event id, sum usage per customer and period by EVENT time,
# close each period after a grace time, and send late events to an adjustment.
import sys

PERIOD, GRACE, QUOTA = 1000, 100, 900
TIERS = [(1000, 10), (1000, 8), (float("inf"), 5)]  # (units in tier, cents per unit)


def cost(units):
    """Price of a total quantity, in cents (tiered: each tier is charged at its own rate)."""
    left, cents = units, 0
    for size, rate in TIERS:
        n = min(left, size)
        cents += n * rate
        left -= n
    return cents


def money(c):
    return f"{c // 100}.{c % 100:02d}"


seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Make 2,000 events over two periods. 1 in 5 is delayed a lot, and 1 in 10 is sent twice.
stream = []
for event_id in range(2000):
    ev = {"id": event_id, "customer": random(3), "ts": random(2 * PERIOD), "qty": 1 + random(5)}
    delay = random(600) if random(10) < 2 else random(20)
    stream.append({**ev, "arrival": ev["ts"] + delay})
    if random(10) == 0:
        stream.append({**ev, "arrival": ev["ts"] + delay + random(50)})
stream.sort(key=lambda e: (e["arrival"], e["id"]))

seen, live, snapshot, closed, late, truth = set(), {}, {}, set(), {}, {}
crossed = {}  # "customer:period" -> arrival time when usage passed the quota
duplicates = 0


def key(c, p):
    return f"{c}:{p}"


def add(m, k, q):
    m[k] = m.get(k, 0) + q


def close_due(now):  # close every period whose grace time has passed
    for p in range(2):
        if p not in closed and (p + 1) * PERIOD + GRACE <= now:
            for c in range(3):
                snapshot[key(c, p)] = live.get(key(c, p), 0)
            closed.add(p)


for ev in stream:
    close_due(ev["arrival"])
    if ev["id"] in seen:
        duplicates += 1
        continue
    seen.add(ev["id"])
    p = ev["ts"] // PERIOD
    k = key(ev["customer"], p)
    add(truth, k, ev["qty"])
    if p in closed:  # the invoice is already out
        add(late, k, ev["qty"])
        continue
    add(live, k, ev["qty"])
    if live[k] > QUOTA and k not in crossed:
        crossed[k] = ev["arrival"]
close_due(float("inf"))

print(f"events {len(stream)}, unique {len(seen)}, duplicates dropped {duplicates}")
ok = True
for p in range(2):
    for c in range(3):
        k = key(c, p)
        billed, extra = snapshot[k], late.get(k, 0)
        adj = cost(billed + extra) - cost(billed)
        print(f"period {p} customer {c}: invoiced {billed} units = {money(cost(billed))}, late {extra} units, adjustment {money(adj)}")
        if billed + extra != truth[k]:  # reconciliation against the raw unique events
            ok = False
print(f"quota {QUOTA} crossed: " + ", ".join(f"{k} at {t}" for k, t in sorted(crossed.items())))
print(f"reconciled: {'true' if ok else 'false'}")
if not ok or len(seen) + duplicates != len(stream):
    sys.exit(1)
