# A miniature of the ideas in Amazon's Dynamo paper (SOSP 2007), in Python (a teaching model, not Amazon's code):
# a ring of nodes, N=3 replicas, R=2 and W=2, a sloppy quorum with hinted handoff, and vector clocks that keep
# concurrent shopping-cart updates as siblings until a reader merges them. Everything is deterministic.

NODES = [("A", 10), ("B", 30), ("C", 50), ("D", 70), ("E", 90)]  # name and position on a ring of 100 points
N, R, W = 3, 2, 2
down = set()
store = {name: [] for name, _ in NODES}  # versions held by each node


def position(key):
    return sum(ord(ch) for ch in key) % 100


def walk(key):  # every node, clockwise from the key's position
    start = next((i for i, (_, pos) in enumerate(NODES) if pos >= position(key)), 0)
    return [NODES[(start + k) % len(NODES)][0] for k in range(len(NODES))]


def healthy(key):
    return [n for n in walk(key) if n not in down]


def show(clock):
    return ",".join(f"{k}:{clock[k]}" for k in sorted(clock))


def descends(a, b):
    return all(a.get(k, 0) >= c for k, c in b.items())


def put(key, items, context, coordinator=None):
    clock = dict(context)
    coord = coordinator or healthy(key)[0]
    clock[coord] = clock.get(coord, 0) + 1
    owners = walk(key)[:N]
    missing = [n for n in owners if n in down]  # owners that cannot take their copy
    targets = healthy(key)[:N]
    for t in targets:
        own = t in owners
        version = {"key": key, "clock": clock, "items": items, "hintFor": None if own else missing.pop(0)}
        store[t] = [v for v in store[t] if v["key"] != key or not descends(clock, v["clock"])] + [version]
    hints = [t for t in targets if t not in owners]
    note = f", hint kept on {','.join(hints)}" if hints else ""
    print(f"put {key} {'+'.join(items)} via {coord} clock {show(clock)}: {len(targets)} acks, {'ok' if len(targets) >= W else 'FAILED'}{note}")


def get(key):
    seen = []
    for n in healthy(key)[:R]:
        seen += [v for v in store[n] if v["key"] == key]
    kept = []
    for i, v in enumerate(seen):
        beaten = any(
            (descends(o["clock"], v["clock"]) and show(o["clock"]) != show(v["clock"]))
            or (show(o["clock"]) == show(v["clock"]) and j < i)
            for j, o in enumerate(seen)
        )
        if not beaten:
            kept.append(v)
    print(f"get {key} from {','.join(healthy(key)[:R])}: " + " | ".join(f"[{'+'.join(v['items'])}] {show(v['clock'])}" for v in kept))
    return kept


def handoff():
    for n in list(store):
        for v in list(store[n]):
            if v["hintFor"] and v["hintFor"] not in down and n not in down:
                store[v["hintFor"]].append({**v, "hintFor": None})
                store[n].remove(v)
                print(f"handoff: {n} gave {v['key']} {show(v['clock'])} back to {v['hintFor']}")


key = "cart:ann"
print(f"ring position {position(key)}, preference list {','.join(walk(key)[:N])}")
put(key, ["book"], {})
cart = get(key)[0]
down.add("B")
print("B goes down")
put(key, cart["items"] + ["pen"], cart["clock"])
cart = get(key)[0]
down.discard("B")
print("B comes back")
handoff()
print("two clients both start from the same cart and write through different coordinators")
base = cart
put(key, base["items"] + ["mug"], base["clock"], "A")
put(key, base["items"] + ["lamp"], base["clock"], "C")
siblings = get(key)
merged = sorted({i for v in siblings for i in v["items"]})
context = {}
for v in siblings:
    for k, c in v["clock"].items():
        context[k] = max(context.get(k, 0), c)
print(f"the reader merges {len(siblings)} siblings into {'+'.join(merged)}")
put(key, merged, context)
get(key)
