# A tiny feature store in Python:
# one feature definition feeds an offline log and an online store, and training labels are joined "as of" their own time.
import json
import sys

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Raw purchase events: the source of truth. Time only moves forward.
events = []
t = 0
for _ in range(300):
    t += 1 + random(5)
    events.append({"user": random(6), "ts": t, "amount": 1 + random(100)})


# The single feature definition: per user, total spend and purchase count so far.
# The offline log and the online store both use it, so they cannot drift apart.
def compute_rows(items):
    state, rows = {}, []
    for e in items:
        s = state.get(e["user"], {"sum": 0, "count": 0})
        s["sum"] += e["amount"]
        s["count"] += 1
        state[e["user"]] = s
        rows.append({"user": e["user"], "ts": e["ts"], "sum": s["sum"], "count": s["count"]})
    return rows


offline = compute_rows(events)  # append-only history of every feature value, with the time it became true

# Online store: only the newest value per user. Delivery is out of order here, so a write with an older time is ignored.
online = {}
delivery = list(offline)
for i in range(0, len(delivery) - 1, 3):
    delivery[i], delivery[i + 1] = delivery[i + 1], delivery[i]
for r in delivery:
    cur = online.get(r["user"])
    if cur is None or r["ts"] >= cur["ts"]:
        online[r["user"]] = r


# Point-in-time join: the last row of this user whose time is at or before the label time (binary search).
def as_of(user, ts):
    rows = [r for r in offline if r["user"] == user]
    lo, hi = 0, len(rows)
    while lo < hi:
        mid = (lo + hi) >> 1
        if rows[mid]["ts"] <= ts:
            lo = mid + 1
        else:
            hi = mid
    return {"sum": 0, "count": 0} if lo == 0 else rows[lo - 1]


# The naive join takes the newest row, which includes the future.
def latest(user):
    return online[user]


# Ground truth, recomputed from the raw events seen up to the label time.
def truth(user, ts):
    mine = [e for e in events if e["user"] == user and e["ts"] <= ts]
    return {"sum": sum(e["amount"] for e in mine), "count": len(mine)}


labels = [{"user": random(6), "ts": 50 + random(700)} for _ in range(40)]
naive_wrong = pit_wrong = 0
for l in labels:
    tr, p, n = truth(l["user"], l["ts"]), as_of(l["user"], l["ts"]), latest(l["user"])
    if p["sum"] != tr["sum"] or p["count"] != tr["count"]:
        pit_wrong += 1
    if n["sum"] != tr["sum"] or n["count"] != tr["count"]:
        naive_wrong += 1
l0 = labels[1]
print(f"events: {len(events)}, feature rows: {len(offline)}, online keys: {len(online)}")
print(f"label 1 (user {l0['user']} at t={l0['ts']}): truth sum {truth(l0['user'], l0['ts'])['sum']}, as-of {as_of(l0['user'], l0['ts'])['sum']}, naive latest {latest(l0['user'])['sum']}")
print(f"labels with a wrong feature: as-of {pit_wrong}, naive latest {naive_wrong} of {len(labels)}")

same = all(r["sum"] == [x for x in offline if x["user"] == u][-1]["sum"] for u, r in online.items())
again = json.dumps(compute_rows(events)) == json.dumps(offline)  # a backfill from the raw events gives the same table
print(f"online equals the newest offline row: {str(same).lower()}; backfill repeats exactly: {str(again).lower()}")
if pit_wrong != 0 or naive_wrong == 0 or not same or not again:
    sys.exit(1)
