# An order state machine and a courier dispatcher, in Python:
# every order change is checked against a table of legal moves and the version the caller saw,
# and a window of orders is assigned to couriers by cost instead of nearest-first.
import sys

LEGAL = {
    "placed": ["accepted", "cancelled"],
    "accepted": ["preparing", "cancelled"],
    "preparing": ["picked_up", "cancelled"],
    "picked_up": ["delivered"],
    "delivered": [],
    "cancelled": [],
}


class Order:
    def __init__(self, id):
        self.id = id
        self.state = "placed"
        self.version = 1
        self.log = ["placed"]
        self.seen = {}

    # The caller names the version it saw and a request id. Only the first matching request wins; a repeat gets the old answer.
    def move(self, to, expected_version, request_id):
        if request_id in self.seen:
            return self.seen[request_id] + " (repeat)"
        if expected_version != self.version:
            result = "stale"
        elif to not in LEGAL[self.state]:
            result = "illegal"
        else:
            self.state = to
            self.version += 1
            self.log.append(to)
            result = "ok"
        self.seen[request_id] = result
        return result


order = Order("o-4471")
calls = [
    ("accepted", 1, "r1"), ("cancelled", 1, "r2"),    # the cancel saw version 1, but the accept already made it version 2
    ("preparing", 2, "r3"), ("delivered", 3, "r4"),   # delivered cannot follow preparing
    ("picked_up", 3, "r5"), ("delivered", 4, "r6"), ("delivered", 4, "r6"),  # the last one is a repeated tap
    ("preparing", 5, "r7"),                            # nothing can follow delivered
]
for to, v, r in calls:
    print(f"{to} (saw v{v}, {r}): {order.move(to, v, r)}")
print(f"final: {order.state} v{order.version}, log: {' > '.join(order.log)}")
if order.version != len(order.log) or order.state != "delivered":
    sys.exit(1)

# Dispatch: orders have a restaurant on a grid and a ready time; couriers have a position. One cell takes one minute.
seed = 42


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def dist(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def detail(c, o):
    t = dist(c, o["rest"])
    return {"travel": t, "food": max(0, t - o["ready"]), "idle": max(0, o["ready"] - t)}


def cost(c, o):  # cold food counts double
    d = detail(c, o)
    return 2 * d["food"] + d["idle"] + d["travel"]


def nearest_first(orders, couriers):  # each order in turn takes the closest courier that is left
    free = list(range(len(couriers)))
    pick = []
    for o in orders:
        best = -1
        for j in free:
            if best < 0 or dist(couriers[j], o["rest"]) < dist(couriers[best], o["rest"]):
                best = j
        free.remove(best)
        pick.append(best)
    return pick


def best_assignment(orders, couriers):  # try every way of pairing, which is fine for a small window (the real thing uses the Hungarian algorithm)
    best = None
    used = set()
    cur = []

    def go(i, total):
        nonlocal best
        if best and total >= best["sum"]:
            return
        if i == len(orders):
            best = {"sum": total, "pick": list(cur)}
            return
        for j in range(len(couriers)):
            if j not in used:
                used.add(j)
                cur.append(j)
                go(i + 1, total + cost(couriers[j], orders[i]))
                cur.pop()
                used.remove(j)

    go(0, 0)
    return best["pick"]


def totals(orders, couriers, pick):
    t = {"travel": 0, "food": 0, "idle": 0, "cost": 0}
    for i, j in enumerate(pick):
        d = detail(couriers[j], orders[i])
        t = {"travel": t["travel"] + d["travel"], "food": t["food"] + d["food"], "idle": t["idle"] + d["idle"],
             "cost": t["cost"] + cost(couriers[j], orders[i])}
    return t


TRIALS = 200  # dispatch windows simulated
BATCH = 6  # orders and couriers per window
GRID = 20  # positions on a 20 x 20 grid
READY_MIN = 4  # food is ready 4..15 minutes after the order
READY_SPREAD = 12


def point():
    x = rnd(GRID)
    y = rnd(GRID)
    return {"x": x, "y": y}


sums = {"nearest": {"travel": 0, "food": 0, "idle": 0, "cost": 0}, "window": {"travel": 0, "food": 0, "idle": 0, "cost": 0}}
strictly_better = 0
for trial in range(TRIALS):  # 200 windows of 6 orders and 6 couriers
    orders = []
    for _ in range(BATCH):
        rest = point()
        orders.append({"rest": rest, "ready": READY_MIN + rnd(READY_SPREAD)})
    couriers = [point() for _ in range(BATCH)]
    a = totals(orders, couriers, nearest_first(orders, couriers))
    b = totals(orders, couriers, best_assignment(orders, couriers))
    if b["cost"] > a["cost"]:
        sys.exit(1)  # the best assignment can never be worse
    if b["cost"] < a["cost"]:
        strictly_better += 1
    for k in a:
        sums["nearest"][k] += a[k]
        sums["window"][k] += b[k]
for name, s in sums.items():
    print(f"{name:<8} travel {s['travel']} min, food waiting {s['food']} min, courier waiting {s['idle']} min, cost {s['cost']}")
print(f"the window assignment was strictly cheaper in {strictly_better} of 200 windows")
if sums["window"]["cost"] >= sums["nearest"]["cost"]:
    sys.exit(1)
