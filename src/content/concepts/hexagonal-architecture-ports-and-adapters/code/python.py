# Hexagonal architecture: one order service built four ways, hit by the same four changes.
# Look for: files edited per change, unrelated behaviour ("bystanders") inside edited files, tests to run again, and how much infrastructure the rule tests need.
# A file is (name, what it holds, shape fields it copies, files it imports). A change touches tokens; a file is edited if it holds or copies one.
# Tokens: rule (business rule), db (how the database is used), vendor (payment vendor details), mail, entry (HTTP details),
# port (the interfaces the core defines), shape (the fields of an order, copied by every file that maps it), wiring (what is plugged into what).
# The "Direct calls" design has no wiring file: its use cases construct the clients themselves.
MAIN_IMPORTS = ["HttpAdapter", "SqlAdapter", "VendorAdapter", "MailAdapter", "PlaceOrder", "CancelOrder", "OrderReport"]
USE_CASES = ["PlaceOrder", "CancelOrder", "OrderReport"]

DESIGNS = [
    ("Direct calls", [
        ("HttpHandler", ["entry"], ["shape"], USE_CASES),
        ("PlaceOrder", ["rule", "db", "vendor", "mail"], ["shape"], ["SqlStore", "VendorClient", "MailClient"]),
        ("CancelOrder", ["rule", "db", "vendor", "mail"], [], ["SqlStore", "VendorClient", "MailClient"]),
        ("OrderReport", ["db"], [], ["SqlStore"]),
        ("SqlStore", ["db"], ["shape"], []),
        ("VendorClient", ["vendor"], [], []),
        ("MailClient", ["mail"], [], []),
    ]),
    ("Ports and adapters", [
        ("HttpAdapter", ["entry"], ["shape"], USE_CASES),
        ("PlaceOrder", ["rule"], [], ["Ports", "Order"]),
        ("CancelOrder", ["rule"], [], ["Ports", "Order"]),
        ("OrderReport", [], [], ["Ports"]),
        ("Order", [], ["shape"], []),
        ("Ports", ["port"], [], ["Order"]),
        ("SqlAdapter", ["db"], ["shape"], ["Ports", "Order"]),
        ("VendorAdapter", ["vendor"], [], ["Ports"]),
        ("MailAdapter", ["mail"], [], ["Ports"]),
        ("Main", ["wiring"], [], MAIN_IMPORTS),
    ]),
    ("Ports shaped like the vendor", [
        ("HttpAdapter", ["entry"], ["shape"], USE_CASES),
        ("PlaceOrder", ["rule", "vendor"], [], ["Ports", "Order"]),  # the use case reads the vendor's status codes
        ("CancelOrder", ["rule", "vendor"], [], ["Ports", "Order"]),
        ("OrderReport", [], [], ["Ports"]),
        ("Order", [], ["shape"], []),
        ("Ports", ["port", "vendor"], [], ["Order"]),  # the port copies the vendor's method names and flags
        ("SqlAdapter", ["db"], ["shape"], ["Ports", "Order"]),
        ("VendorAdapter", ["vendor"], [], ["Ports"]),
        ("MailAdapter", ["mail"], [], ["Ports"]),
        ("Main", ["wiring"], [], MAIN_IMPORTS),
    ]),
    ("Everything behind a port", [
        ("HttpAdapter", ["entry"], ["shape"], ["RequestMapper"]),
        ("RequestMapper", [], ["shape"], USE_CASES),
        ("PlaceOrder", ["rule"], ["shape"], ["Ports", "Order"]),
        ("CancelOrder", ["rule"], [], ["Ports", "Order"]),
        ("OrderReport", [], [], ["Ports"]),
        ("Order", [], ["shape"], []),
        ("Ports", ["port"], [], ["Order"]),
        ("ClockPort", [], [], []),
        ("IdPort", [], [], []),
        ("LoggerPort", [], [], []),
        ("PersistenceMapper", [], ["shape"], ["Order", "PersistenceModel"]),
        ("PersistenceModel", [], ["shape"], []),
        ("SqlAdapter", ["db"], ["shape"], ["Ports", "PersistenceMapper", "PersistenceModel"]),
        ("VendorAdapter", ["vendor"], [], ["Ports"]),
        ("MailAdapter", ["mail"], [], ["Ports"]),
        ("Main", ["wiring"], [], MAIN_IMPORTS),
    ]),
]

CHANGES = [
    ("swap the database engine", ["db", "wiring"]),
    ("switch payment vendor", ["vendor", "wiring"]),
    ("change the free-shipping rule", ["rule"]),
    ("add a field to an order", ["shape"]),
]


def analyse(files, touches):
    def hit(ts):
        return any(t in touches for t in ts)

    edited = [f for f in files if hit(f[1]) or hit(f[2])]
    bystanders = sum(1 for f in edited for t in f[1] if t not in touches)
    retest = {f[0] for f in edited}
    grew = True
    while grew:  # anything that imports a retested file must be retested too
        grew = False
        for f in files:
            if f[0] not in retest and any(c in retest for c in f[3]):
                retest.add(f[0])
                grew = True
    return [f[0] for f in edited], bystanders, len(retest)


def infra_needed_for_rule_tests(files):  # files holding db, vendor or mail that PlaceOrder reaches through imports
    by_name = {f[0]: f for f in files}
    seen = {"PlaceOrder"}
    todo = ["PlaceOrder"]
    while todo:
        for i in by_name[todo.pop()][3]:
            if i not in seen:
                seen.add(i)
                todo.append(i)

    def is_infra(f):
        return any(t in ("db", "vendor", "mail") for t in f[1]) and "port" not in f[1] and "rule" not in f[1]

    return sum(1 for n in seen if is_infra(by_name[n]))


for name, files in DESIGNS:
    print(f"== {name}: {len(files)} files, {infra_needed_for_rule_tests(files)} infrastructure files needed to test the rule")
    te = tb = tr = 0
    for i, (text, touches) in enumerate(CHANGES):
        edited, by, rt = analyse(files, touches)
        print(f"  C{i + 1} {text}: edit {len(edited)} ({', '.join(edited)}); bystander behaviours {by}; retest {rt}")
        te += len(edited)
        tb += by
        tr += rt
    print(f"  four changes: {te} files edited, {tb} bystander behaviours, {tr} retests")
