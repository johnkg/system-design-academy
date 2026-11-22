# Blast radius of one compromised host in 12 services, under four network policies. Toy model: integers and fixed data only.
# Assumption (worst case, stated): every host the attacker can open a connection to can be taken over in turn.
from collections import deque

HOSTS = ["web", "bff", "orders", "payments", "inventory", "search", "users", "orders-db", "users-db", "cache", "ci", "monitor"]
ZONE = {"web": "edge", "bff": "edge", "orders": "app", "payments": "app", "inventory": "app", "search": "app", "users": "app",
        "orders-db": "data", "users-db": "data", "cache": "data", "ci": "ops", "monitor": "ops"}
JEWELS = ["orders-db", "users-db", "payments"]
# The calls the system really needs: (caller, callee, approved). The last four were added since the last policy review (approved = 0).
FLOWS = [
    ("web", "orders", 1), ("web", "search", 1), ("web", "users", 1), ("bff", "orders", 1), ("bff", "users", 0),
    ("orders", "payments", 1), ("orders", "inventory", 1), ("orders", "orders-db", 1), ("orders", "cache", 1),
    ("users", "users-db", 1), ("users", "cache", 1), ("search", "cache", 0),
    ("ci", "web", 1), ("ci", "orders", 1), ("ci", "users", 0),
] + [("monitor", h, 1) for h in ["web", "bff", "orders", "payments", "inventory", "users", "cache"]] + [("monitor", "search", 0)]
# Segmentation: which zone may open connections to which. Inside a zone every host can talk to every other.
ZONE_RULES = {"edge": ["edge", "app"], "app": ["app", "data"], "data": ["data"], "ops": ["ops", "edge", "app", "data"]}


def allowed(variant, exceptions):
    edges = set()
    for a in HOSTS:
        for b in HOSTS:
            if a == b:
                continue
            if variant == "flat" or (variant == "segmented" and ZONE[b] in ZONE_RULES[ZONE[a]]):
                edges.add(a + ">" + b)
    if variant in ("identity", "strict"):
        for a, b, ok in FLOWS:
            if variant == "identity" or ok:
                edges.add(a + ">" + b)
            elif exceptions:
                # The "exception" people grant to unblock a broken flow in a hurry: caller may reach the callee's whole zone.
                for c in HOSTS:
                    if ZONE[c] == ZONE[b] and c != a:
                        edges.add(a + ">" + c)
    return edges


def reach(edges, start):
    seen = {start}
    queue = deque([start])
    while queue:
        a = queue.popleft()
        for b in HOSTS:
            if a + ">" + b in edges and b not in seen:
                seen.add(b)
                queue.append(b)
    seen.discard(start)
    return seen


def report(name, variant, exceptions):
    edges = allowed(variant, exceptions)
    working = len([1 for a, b, _ in FLOWS if a + ">" + b in edges])
    print(f"-- {name}")
    print(f"  allowed connections {len(edges)} of 132; needed flows working {working} of {len(FLOWS)}; connections nobody needs {len(edges) - working}")
    for h in ["web", "search", "ci"]:
        r = reach(edges, h)
        direct = len([1 for b in HOSTS if h + ">" + b in edges])
        jewels = len([1 for j in JEWELS if j in r])
        print(f"  {h} compromised: direct connections {direct}; hosts reached by pivoting {len(r)}; crown jewels reached {jewels} of {len(JEWELS)}")
    total = sum(len(reach(edges, h)) for h in HOSTS)
    print(f"  summed over each of the 12 hosts as the entry point: {total} of 132 host takeovers possible")


report("flat network: everything reaches everything", "flat", False)
report("segmented: zones edge, app, data, ops", "segmented", False)
report("identity-based: mTLS, each service lists who may call it", "identity", False)
report("over-applied: only reviewed flows allowed, no exceptions", "strict", False)
report("over-applied, then broad exceptions granted to unblock", "strict", True)
print("-- search tries to call orders-db directly")
for v in ["flat", "segmented", "identity"]:
    print(f"  {v}: {'allowed' if 'search>orders-db' in allowed(v, False) else 'denied'}")
