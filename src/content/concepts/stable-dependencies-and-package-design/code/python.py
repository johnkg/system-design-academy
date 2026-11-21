# Stable dependencies and package design: the same product split into packages three ways. Each design is DATA: packages
# (with an assumed number of changes per quarter) and "A depends on B" edges. Everything printed is computed from it.
# Terms: Ca is how many packages depend on a package (afferent), Ce is how many it depends on (efferent).
# Instability I = Ce * 100 / (Ca + Ce), rounded down: 0 is maximally stable (others depend on it, it depends on
# nothing), 100 is maximally unstable. The Stable Dependencies Principle: depend in the direction of stability, so an
# edge from A to B is a violation when B is less stable than A. Acyclic Dependencies: no package can reach itself.
# Look for: the cycle among orders, billing, customers and utils, what one change to utils rebuilds, and what splitting
# every class into its own package costs when a feature crosses layers.


def design(name, changes, edges, feature, roles):
    return {"name": name, "changes": changes, "edges": [tuple(e.split(">")) for e in edges], "feature": feature, "roles": roles}


DESIGNS = [
    design("Tangled: a utils package and a cycle",
           {"web": 10, "orders": 8, "billing": 6, "customers": 5, "notifications": 3, "reports": 4, "utils": 12},
           ["web>orders", "web>billing", "web>reports", "web>notifications", "orders>billing", "billing>customers", "customers>orders", "orders>utils",
            "billing>utils", "customers>utils", "notifications>utils", "notifications>customers", "reports>orders", "reports>utils", "utils>customers"],
           ["customers", "billing", "web"],
           {"helper": "utils", "customerRules": "customers", "orderRules": "orders", "customerContract": "customers"}),
    design("Layered: acyclic, small stable bases",
           {"web": 10, "orders": 8, "billing": 6, "customers": 5, "notifications": 3, "reports": 4, "money": 1, "text": 2},
           ["web>orders", "web>billing", "web>reports", "web>notifications", "orders>billing", "orders>customers", "billing>customers", "billing>money",
            "reports>orders", "reports>text", "notifications>customers", "notifications>text", "customers>money"],
           ["customers", "billing", "web"],
           {"helper": "money", "customerRules": "customers", "orderRules": "orders", "customerContract": "customers"}),
    design("Over-split: an api and an impl package for everything",
           {"web": 10, "orders-api": 1, "orders-impl": 8, "billing-api": 1, "billing-impl": 6, "customers-api": 1, "customers-impl": 5,
            "notifications-api": 1, "notifications-impl": 3, "reports": 4, "money": 1, "text": 2, "app": 3},
           ["web>orders-api", "web>billing-api", "web>reports", "web>notifications-api", "orders-impl>orders-api", "orders-impl>billing-api",
            "orders-impl>customers-api", "billing-impl>billing-api", "billing-impl>customers-api", "billing-impl>money", "customers-impl>customers-api",
            "customers-impl>money", "notifications-impl>notifications-api", "notifications-impl>customers-api", "notifications-impl>text",
            "reports>orders-api", "reports>text", "app>web", "app>orders-impl", "app>billing-impl", "app>customers-impl", "app>notifications-impl"],
           ["customers-api", "customers-impl", "billing-api", "billing-impl", "web"],
           {"helper": "money", "customerRules": "customers-impl", "orderRules": "orders-impl", "customerContract": "customers-api"}),
]
CHANGES = [("helper", "the shared helper package"), ("customerRules", "customer rules"), ("orderRules", "order rules"), ("customerContract", "the customer contract")]


def reach(edges, start):
    """Packages reachable from `start` by following edges forward (breadth-first); `start` itself only if a cycle returns to it."""
    seen, queue = set(), [start]
    while queue:
        cur = queue.pop(0)
        for a, b in edges:
            if a == cur and b not in seen:
                seen.add(b)
                queue.append(b)
    return seen


def rebuild_set(d, p):
    """A change to p forces a rebuild and retest of p and of every package that depends on it, directly or not."""
    out = {p}
    for q in d["changes"]:
        if p in reach(d["edges"], q):
            out.add(q)
    return out


def in_cycle(d):
    return [p for p in d["changes"] if p in reach(d["edges"], p)]


def instability(d, p):
    ce = len([e for e in d["edges"] if e[0] == p])
    ca = len([e for e in d["edges"] if e[1] == p])
    return 0 if ca + ce == 0 else (ce * 100) // (ca + ce)


def violations(d):
    return [e for e in d["edges"] if instability(d, e[1]) > instability(d, e[0])]


def builds_per_quarter(d):
    """Every change to a package rebuilds its whole rebuild set."""
    return sum(d["changes"][p] * len(rebuild_set(d, p)) for p in d["changes"])


for d in DESIGNS:
    total = len(d["changes"])
    print(f"== {d['name']}")
    print(f"  packages: {total}; dependency edges: {len(d['edges'])}; packages in a cycle (must be released together): {len(in_cycle(d))}; edges that depend on something less stable: {len(violations(d))}")
    print(f"  package builds per quarter, from the assumed change counts: {builds_per_quarter(d)}; packages edited by a feature that adds one customer field to the web page: {len(d['feature'])}")
    for key, label in CHANGES:
        p = d["roles"][key]
        print(f"  a change to {label} ({p}, instability {instability(d, p)}) rebuilds and retests {len(rebuild_set(d, p))} of {total} packages")
