# Monolith, modular monolith and microservices: one shop (6 modules) cut into deployable units five ways, hit by the same four changes.
# Look for: deploys per change, teams that must ship a release (in one deployable that is every team; with separate services each ships on its own schedule unless they share a database), network calls per checkout, and how many modules fail when Payments misbehaves.
# A design says how modules map to deployables (together = one process), whether the database is shared, whether module internals leak to callers,
# whether callers have fallbacks, and how many separate services one module is split into (1 or 3: api, logic, store).
# Assumption for latency: every network call costs the same fixed number of milliseconds (here 2).
MODULES = ["catalog", "cart", "orders", "payments", "shipping", "notify"]
CHECKOUT = [("orders", "cart"), ("cart", "catalog"), ("orders", "payments"), ("orders", "shipping"), ("shipping", "notify")]  # caller, callee
LAYERS = ["api", "logic", "store"]

# (name, together, shared_db, leaky, split, fallbacks)
DESIGNS = [
    ("Big ball monolith", True, True, True, 1, False),
    ("Modular monolith", True, False, False, 1, False),
    ("Microservices", False, False, False, 1, True),
    ("Distributed monolith", False, True, True, 1, False),
    ("Nanoservices", False, False, False, 3, False),
]

# (text, kind, module, consumers); kind: logic (private rule), contract (a field others read), schema (a table column), all (a platform upgrade)
CHANGES = [
    ("change a price rule in Catalog", "logic", "catalog", []),
    ("add a field to the Orders contract", "contract", "orders", ["payments", "shipping", "notify"]),
    ("rename a column in the Orders table", "schema", "orders", []),
    ("upgrade the web framework everywhere", "all", "", []),
]


def callers_of(m):
    return [a for a, b in CHECKOUT if b == m]


# Edits as (module, layers touched). Layers only matter when a module is split into 3 services.
def edits(d, c):
    _, _, shared_db, leaky, _, _ = d
    _, kind, module, consumers = c
    if kind == "all":
        return [(m, LAYERS) for m in MODULES]
    if kind == "logic":
        return [(module, ["logic"])] + ([(m, ["logic"]) for m in callers_of(module)] if leaky else [])
    if kind == "contract":
        return [(module, LAYERS)] + [(m, ["logic"]) for m in consumers]
    if shared_db:
        return [(m, ["logic", "store"] if m == module else ["logic"]) for m in MODULES]
    return [(module, ["logic", "store"])]


def deployable(d, m, layer):
    _, together, _, _, split, _ = d
    if together:
        return "app"
    return m if split == 1 else m + "." + layer


def analyse(d, c):
    es = edits(d, c)
    units = set()
    for m, layers in es:
        for l in layers:
            units.add(deployable(d, m, l))
    teams = len(MODULES) if d[1] else len(es)  # one team per module; a shared deployable makes every team wait
    return len(es), len(units), teams


def checkout_calls(d):
    if d[1]:
        return 0
    visited = set()
    for a, b in CHECKOUT:
        visited.add(a)
        visited.add(b)
    return len(CHECKOUT) + (2 * len(visited) if d[4] == 3 else 0)  # api -> logic -> store inside each module is 2 more calls


def failing(d):  # modules whose requests fail when Payments crashes or holds a lock
    if d[1] or d[2]:
        return len(MODULES)
    out = {"payments"}
    if not d[5]:
        grew = True
        while grew:
            grew = False
            for a, b in CHECKOUT:
                if b in out and a not in out:
                    out.add(a)
                    grew = True
    return len(out)


MS = 2
for d in DESIGNS:
    calls = checkout_calls(d)
    print(f"== {d[0]}: {calls} network calls per checkout ({calls * MS} ms at {MS} ms each), {failing(d)} of {len(MODULES)} modules fail when Payments misbehaves")
    tm = td = tt = 0
    for i, c in enumerate(CHANGES):
        m, dp, t = analyse(d, c)
        print(f"  C{i + 1} {c[0]}: edit {m} modules, {dp} deploys, {t} teams must ship")
        tm += m
        td += dp
        tt += t
    print(f"  four changes: {tm} modules edited, {td} deploys, {tt} team-releases")
