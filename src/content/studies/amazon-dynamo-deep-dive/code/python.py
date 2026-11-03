# A miniature of the ideas in the 2007 Dynamo paper, in Python (a teaching model, not Amazon's code): a key is hashed onto a
# ring, copied to the first N healthy nodes of its preference list (a sloppy quorum with a hinted stand-in), every update carries a
# vector clock, and a read that finds conflicting versions returns all of them for the application to merge.
# Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
import sys

NODES = ["A", "B", "C", "D", "E", "F"]
N = 3  # replicas per key
R = 2  # replies a read waits for
W = 2  # acknowledgements a write waits for


# 32-bit FNV-1a: a stand-in for the MD5 hash Dynamo puts on a key.
def fnv(text):
    h = 0x811C9DC5
    for b in text.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


# The ring: each node sits at a position, and a key belongs to the first node clockwise from its own position.
ring = sorted(({"node": node, "at": fnv(f"node-{node}")} for node in NODES), key=lambda slot: slot["at"])


def preference_list(key):
    start = next((i for i, slot in enumerate(ring) if slot["at"] >= fnv(key)), 0)
    return [ring[(start + i) % len(ring)]["node"] for i in range(len(ring))]


# A vector clock maps a node to a counter. a descends from b when every counter in b is at most the one in a.
def descends(a, b):
    return all(a.get(node, 0) >= counter for node, counter in b.items())


def show(clock):
    return "{" + ",".join(f"{node}:{counter}" for node, counter in sorted(clock.items())) + "}"


stores = {node: [] for node in NODES}  # node -> versions of the cart: {value, clock}
hints = []  # {holder, intended, version}


# A put goes to the first N healthy nodes of the preference list. A node that is down is replaced by the next healthy one,
# which keeps a hint so that it can hand the copy back.
def put(value, clock, coordinator, down, order):
    next_clock = {**clock, coordinator: clock.get(coordinator, 0) + 1}
    version = {"value": value, "clock": next_clock}
    wanted = order[:N]
    chosen = [node for node in order if node not in down][:N]
    for node in chosen:
        stores[node] = [old for old in stores[node] if not descends(next_clock, old["clock"])] + [version]
        if node not in wanted:
            hints.append({"holder": node, "intended": next(w for w in wanted if w in down), "version": version})
    accepted = len(chosen) >= W
    print(f"put {value} clock {show(next_clock)} stored on {''.join(chosen)}{', accepted' if accepted else ', REFUSED'}")
    return next_clock, accepted


# A get asks R nodes and keeps every version that no other version descends from.
def get(ask_nodes):
    found = {}
    for node in ask_nodes[:R]:
        for v in stores[node]:
            found[show(v["clock"])] = v
    everything = list(found.values())
    return [v for v in everything if not any(descends(o["clock"], v["clock"]) and not descends(v["clock"], o["clock"]) for o in everything)]


order_of_nodes = preference_list("cart-42")
first, second, third = order_of_nodes[0], order_of_nodes[1], order_of_nodes[2]
print(f"--- preference list for cart-42: {''.join(order_of_nodes[:N])} (then {''.join(order_of_nodes[N:])} as spares)")
print(f"--- {third} is down: writes still succeed, and {order_of_nodes[N]} keeps a hint")
down_nodes = {third}
v1_clock, _ = put("book", {}, first, set(), order_of_nodes)
v2_clock, v2_ok = put("book,pen", v1_clock, first, down_nodes, order_of_nodes)  # client 1 adds a pen, from the clock it read
v3_clock, v3_ok = put("book,mug", v1_clock, second, down_nodes, order_of_nodes)  # client 2 adds a mug from the same older clock: a conflict

print("--- read: two versions that neither descends from the other")
seen = get([first, second])
print(f"versions returned: {' | '.join(sorted(v['value'] for v in seen))}")
merged = ",".join(sorted({item for v in seen for item in v["value"].split(",")}))
context = {}
for v in seen:
    for node, counter in v["clock"].items():
        context[node] = max(context.get(node, 0), counter)
v4_clock, v4_ok = put(merged, context, first, down_nodes, order_of_nodes)
print(f"after the merge a read returns {' | '.join(v['value'] for v in get([first, second]))}")

print("--- hinted handoff when the node returns")
for hint in hints:
    stores[hint["intended"]] = [old for old in stores[hint["intended"]] if not descends(hint["version"]["clock"], old["clock"])] + [hint["version"]]
    print(f"{hint['holder']} hands {hint['version']['value']} back to {hint['intended']}")
holders = [node for node in order_of_nodes[:N] if len(stores[node]) == 1 and stores[node][0]["value"] == merged]
print(f"nodes holding the merged cart: {''.join(holders)}")
ok = v2_ok and v3_ok and v4_ok and len(seen) == 2 and merged == "book,mug,pen" and len(holders) == N
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
