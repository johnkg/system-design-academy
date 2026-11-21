# Separation of concerns and layering: one small app (orders, invoices, customers) built four ways, hit by the same five changes.
# Look for: files edited per change, edits that only forward data ("forwarding"), and unrelated behaviour ("bystanders") inside edited files.
# A layer is (name, what it holds, what it only passes along). Every feature gets one file per layer, and each file calls the next layer down.
# Tokens: ui, rule, data (query shape), db (engine details), shape (the fields of a record, copied by every layer that maps it).
FEATURES = ["orders", "invoices", "customers"]

DESIGNS = [
    ("Leaky layers", [
        ("Controller", ["ui", "data"], ["shape"]),  # the screen code knows column names
        ("Service", ["rule", "data"], ["shape"]),  # the rules build queries
        ("Repository", ["data", "db"], ["shape"]),
    ]),
    ("Clean layers", [
        ("Controller", ["ui"], ["shape"]),
        ("Service", ["rule"], []),
        ("Repository", ["data", "db"], ["shape"]),
    ]),
    ("Vertical slices", [
        ("Slice", ["ui", "rule", "data", "db"], []),
    ]),
    ("Over-layered", [
        ("Controller", ["ui"], ["shape"]),
        ("Facade", [], ["shape"]),
        ("Service", ["rule"], ["shape"]),
        ("Manager", ["rule"], ["shape"]),
        ("DomainModel", [], ["shape"]),
        ("Repository", ["data"], ["shape"]),
        ("Dao", ["data", "db"], ["shape"]),
    ]),
]

CHANGES = [
    ("add a field to the order screen", ["orders.ui", "orders.data", "orders.shape"]),
    ("change the order discount rule", ["orders.rule"]),
    ("rename an invoice column", ["invoices.data"]),
    ("swap the database engine", ["orders.db", "invoices.db", "customers.db"]),
    ("restyle every screen", ["orders.ui", "invoices.ui", "customers.ui"]),
]


def build(layers):
    mods = []
    for f in FEATURES:
        for i, (layer, holds, passes) in enumerate(layers):
            name = f.capitalize() + layer
            nxt = f.capitalize() + layers[i + 1][0] if i + 1 < len(layers) else None
            mods.append((name, [f + "." + t for t in holds], [f + "." + t for t in passes], [nxt] if nxt else []))
    return mods


def analyse(mods, touches):
    edited = [m for m in mods if any(t in touches for t in m[1] + m[2])]
    forwarding = [m for m in edited if not any(t in touches for t in m[1])]
    bystanders = sum(1 for m in edited for t in m[1] if t not in touches)
    retest = {m[0] for m in edited}
    grew = True
    while grew:  # anything that calls a retested file must be retested too
        grew = False
        for m in mods:
            if m[0] not in retest and any(c in retest for c in m[3]):
                retest.add(m[0])
                grew = True
    return [m[0] for m in edited], len(forwarding), bystanders, len(retest)


for name, layers in DESIGNS:
    mods = build(layers)
    print(f"== {name}: {len(mods)} files, {len(layers)} files on the path of one request")
    te = tf = tb = tr = 0
    for i, (text, touches) in enumerate(CHANGES):
        edited, fwd, by, rt = analyse(mods, touches)
        print(f"  C{i + 1} {text}: edit {len(edited)} ({', '.join(edited)}); forwarding {fwd}; bystander behaviours {by}; retest {rt}")
        te += len(edited)
        tf += fwd
        tb += by
        tr += rt
    print(f"  five changes: {te} files edited, {tf} forwarding edits, {tb} bystander behaviours, {tr} retests")
