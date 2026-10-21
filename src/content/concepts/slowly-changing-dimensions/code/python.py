# Slowly changing dimensions: Type 1 overwrite vs Type 2 history, in Python.
# Customers move between regions while sales continue. Days are 1..360; a row is valid for from <= day < to.
import sys

REGIONS = ["North", "South", "East", "West"]
INIT = ["North", "South", "East", "South", "West", "East", "North", "West"]
DAYS = 360
FACTS = 200  # sales in the demo
MIN_AMOUNT = 20  # sale amounts are 20..200
AMOUNT_SPREAD = 181
DAY_KEY = 1000000  # event sort key: day * DAY_KEY + position
FACT_AFTER_CHANGES = 100000  # on the same day, changes load before facts
# The change feed: customer index, effective day, arrival day, new region and tier.
FEED = [
    (6, 80, 80, "South", "basic"),
    (1, 100, 100, "West", "basic"),
    (3, 150, 250, "East", "basic"),   # late-arriving: effective day 150, delivered on day 250
    (4, 200, 200, "North", "basic"),
    (0, 200, 200, "North", "basic"),  # redelivered, nothing changed
    (4, 220, 220, "North", "gold"),   # tier only: still a new version, because tier is tracked
    (6, 270, 270, "East", "basic"),
    (2, 300, 300, "South", "basic"),
]

seed = 7  # 32-bit LCG so every language produces the same sales
def nxt():
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return seed >> 8

facts = []
for i in range(FACTS):
    facts.append({"id": i, "day": 1 + nxt() % DAYS, "cust": nxt() % len(INIT), "amount": MIN_AMOUNT + nxt() % AMOUNT_SPREAD})

def hash_of(region, tier):  # hash of the tracked attributes only (FNV-1a, 32 bit)
    h = 2166136261
    for ch in f"{region}|{tier}":
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h

def load(kind, correct_late):
    rows, skipped, rekeyed = [], 0, 0
    for cust, region in enumerate(INIT):
        rows.append({"sk": len(rows) + 1, "cust": cust, "region": region, "hash": hash_of(region, "basic"), "from": 1, "to": None})
    def covering(cust, day):
        return next(r for r in rows if r["cust"] == cust and r["from"] <= day and (r["to"] is None or day < r["to"]))
    events = [(c[2] * DAY_KEY + i, c, None) for i, c in enumerate(FEED)] + [(f["day"] * DAY_KEY + FACT_AFTER_CHANGES + f["id"], None, f) for f in facts]
    fact_sk = {}
    for _, change, fact in sorted(events, key=lambda e: e[0]):
        if change:
            cust, eff, arrive, region, tier = change
            h = hash_of(region, tier)
            if kind == 1:  # overwrite in place: no history
                r = next(x for x in rows if x["cust"] == cust)
                if r["hash"] == h: skipped += 1
                else: r["region"], r["hash"] = region, h
            else:  # Type 2: close the version that was open, insert the new one
                vf = eff if correct_late else arrive  # valid_from = when it became true, not when we heard
                old = covering(cust, vf)
                if old["hash"] == h:
                    skipped += 1
                    continue
                row = {"sk": len(rows) + 1, "cust": cust, "region": region, "hash": h, "from": vf, "to": old["to"]}
                old["to"] = vf
                rows.append(row)
                for f in facts:  # facts already loaded for that period point at the old version: re-key them
                    if f["cust"] == cust and f["id"] in fact_sk and f["day"] >= row["from"] and (row["to"] is None or f["day"] < row["to"]):
                        fact_sk[f["id"]] = row["sk"]
                        rekeyed += 1
        else:  # point-in-time lookup: the version valid on the sale date
            fact_sk[fact["id"]] = next(x for x in rows if x["cust"] == fact["cust"])["sk"] if kind == 1 else covering(fact["cust"], fact["day"])["sk"]
    by_sk = {r["sk"]: r for r in rows}
    return {"rows": rows, "skipped": skipped, "rekeyed": rekeyed, "region_of": lambda f: by_sk[fact_sk[f["id"]]]["region"]}

def truth_region(f):  # reality, from the feed alone (effective dates)
    region, best = INIT[f["cust"]], 0
    for cust, eff, _, reg, _ in FEED:
        if cust == f["cust"] and eff <= f["day"] and eff >= best:
            region, best = reg, eff
    return region

def revenue(region_of):
    t = {r: 0 for r in REGIONS}
    for f in facts: t[region_of(f)] += f["amount"]
    return t

def show(name, t):
    print(name.ljust(13) + "  ".join(f"{r} {t[r]:>5}" for r in REGIONS))

def check(ok, msg):
    if not ok:
        print("FAILED: " + msg)
        sys.exit(1)

truth = revenue(truth_region)
t1, t2naive, t2fix = load(1, False), load(2, False), load(2, True)
show("true then", truth)
show("type 1", revenue(t1["region_of"]))
show("type 2 naive", revenue(t2naive["region_of"]))
show("type 2 fixed", revenue(t2fix["region_of"]))
wrong = lambda l: sum(1 for f in facts if l["region_of"](f) != truth_region(f))
print(f"rows: type1={len(t1['rows'])} type2naive={len(t2naive['rows'])} type2fixed={len(t2fix['rows'])}")
print(f"facts on the wrong version: type1={wrong(t1)} type2naive={wrong(t2naive)} type2fixed={wrong(t2fix)}")
print(f"skipped unchanged records: {t2fix['skipped']}, facts re-keyed by the correction: {t2fix['rekeyed']}")

check(revenue(t2fix["region_of"]) == truth, "type 2 with correction must match the true-at-the-time totals")
check(revenue(t1["region_of"]) != truth, "type 1 must differ from the true-at-the-time totals")
check(wrong(t2naive) > 0, "a late change without correction must mis-join some facts")
for l in (t1, t2naive, t2fix):
    for c in range(len(INIT)):
        mine = sorted((r for r in l["rows"] if r["cust"] == c), key=lambda r: r["from"])
        check(sum(1 for r in mine if r["to"] is None) == 1, "exactly one current row per customer")
        check(all(i == 0 or mine[i - 1]["to"] == r["from"] for i, r in enumerate(mine)), "versions must be contiguous")
print("all checks passed")
