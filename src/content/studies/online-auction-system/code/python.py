# An auction in Python: optimistic concurrency, proxy bidding, anti-sniping extension and an exactly-once close.
# All money is in whole units, so every language prints the same result.
START, STEP, WINDOW, MAX_EXTENSIONS = 100, 5, 120, 8


def new_auction(ends_at):
    return {"version": 0, "price": START, "leader": -1, "leader_max": 0, "ends_at": ends_at,
            "extensions": 0, "settled": False, "accepted": []}


def place_bid(a, bidder, max_bid, now, seen_version):
    """A bid says 'I will pay up to max'. It is only applied if the version the bidder saw is still current."""
    if a["settled"] or now >= a["ends_at"]:
        return "closed"
    if seen_version != a["version"]:
        return "conflict"                                   # someone else won the race: re-read and retry
    floor = START if a["leader"] < 0 else a["price"] + STEP
    if max_bid < floor:
        return "too low"
    if a["leader"] < 0:
        a["leader"], a["leader_max"] = bidder, max_bid
    elif bidder == a["leader"]:
        a["leader_max"] = max(a["leader_max"], max_bid)     # raising your own ceiling does not move the price
    elif max_bid > a["leader_max"]:
        a["price"] = min(max_bid, a["leader_max"] + STEP)
        a["leader"], a["leader_max"] = bidder, max_bid
    else:
        a["price"] = min(a["leader_max"], max_bid + STEP)   # the leader's proxy answers for them
    if a["ends_at"] - now < WINDOW and a["extensions"] < MAX_EXTENSIONS:
        a["ends_at"] = now + WINDOW                         # anti-sniping
        a["extensions"] += 1
    a["version"] += 1
    a["accepted"].append((bidder, max_bid))
    return "ok"


def close_once(a, orders):
    """The close job may be delivered several times. The first compare-and-set on 'settled' wins."""
    if a["settled"]:
        return False
    a["settled"] = True
    orders["order-1"] = (a["leader"], a["price"])           # keyed by auction, so a repeat could not add a second order
    return True


seed = 77


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


a = new_auction(1000)
stats = {"ok": 0, "conflict": 0, "too low": 0}


def tally(r):
    if r in stats:
        stats[r] += 1


now, last_price = 0, START
while now < a["ends_at"]:
    now += 10 + rnd(25) + a["extensions"] * 12              # bidders slow down as the fight goes on
    if now >= a["ends_at"]:
        break
    seen = a["version"]                                     # two bidders read the same version at once
    for bidder in [rnd(6), rnd(6)]:
        max_bid = a["price"] + STEP * (1 + rnd(8))
        r = place_bid(a, bidder, max_bid, now, seen)
        tally(r)
        if r == "conflict":
            r = place_bid(a, bidder, max_bid + STEP, now, a["version"])  # retry with fresh state
            tally(r)
        assert a["price"] >= last_price, "price went down"
        last_price = a["price"]

orders = {}
closes = [close_once(a, orders), close_once(a, orders), close_once(a, orders)]  # three deliveries of the same job
# Oracle: the winner has the highest ceiling, and pays one step over the second highest (capped at their own ceiling).
best = {}
for bidder, m in a["accepted"]:
    if bidder not in best or m > best[bidder]:
        best[bidder] = m
ceilings = sorted(best.values(), reverse=True)
expected = min(ceilings[0], ceilings[1] + STEP) if len(ceilings) > 1 else START
print(f"accepted {stats['ok']}, conflicts {stats['conflict']}, too low {stats['too low']}, version {a['version']}")
print(f"ended at {a['ends_at']} after {a['extensions']} extensions")
print(f"winner #{a['leader']} pays {a['price']}, expected {expected}")
print(f"closes: {','.join('true' if c else 'false' for c in closes)}; orders: {len(orders)}")
assert a["price"] == expected and a["version"] == stats["ok"] and len(orders) == 1 and sum(closes) == 1
