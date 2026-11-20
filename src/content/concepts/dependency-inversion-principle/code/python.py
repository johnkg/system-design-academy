# Dependency inversion: an order service that builds its own SMTP mailer and database, against one that OWNS the
# abstractions it needs and receives implementations. Part 1 runs both for real and counts calls that would leave the
# process. Part 2 is a small model of four codebases: it counts what a change touches. Look for: the high-level files
# touched when the mail provider is swapped, and how many tests need real infrastructure.
real_calls = 0  # every call to SMTP or SQL


class SmtpMailer:
    def notify(self, to, text):
        global real_calls
        real_calls += 1


class SqlDatabase:
    def save(self, order):
        global real_calls
        real_calls += 1


# Hard-wired: the policy creates its own details.
class HardOrderService:
    def __init__(self):
        self.mailer = SmtpMailer()
        self.db = SqlDatabase()

    def place(self, order):
        if order["qty"] <= 0:
            return "rejected"
        self.db.save(order)
        self.mailer.notify(order["email"], f"order {order['id']} placed")
        return "placed"


# Owned abstraction: OrderService states what it needs (notify, save) in its own terms; details implement that.
class OrderService:
    def __init__(self, notifier, store):
        self.notifier = notifier
        self.store = store

    def place(self, order):
        if order["qty"] <= 0:
            return "rejected"
        self.store.save(order)
        self.notifier.notify(order["email"], f"order {order['id']} placed")
        return "placed"


class FakeNotifier:
    def __init__(self):
        self.sent = []

    def notify(self, to, text):
        self.sent.append(f"{to}: {text}")


class FakeStore:
    def __init__(self):
        self.saved = 0

    def save(self, order):
        self.saved += 1


order = {"id": 7, "qty": 2, "email": "a@x.io"}
print(f"hard-wired test: {HardOrderService().place(order)}, real calls {real_calls}")
real_calls = 0
notifier, store = FakeNotifier(), FakeStore()
print(f'owned abstraction, fakes: {OrderService(notifier, store).place(order)}, real calls {real_calls}, saved {store.saved}, sent "{notifier.sent[0]}"')
print(f"production wiring: {OrderService(SmtpMailer(), SqlDatabase()).place(order)}, real calls {real_calls}")


# Part 2: the model. uses = what a file calls; impl = the interface a detail implements; tests = tests whose subject is the file.
def F(name, kind, uses, tests, impl="", rule=False):
    return {"name": name, "kind": kind, "uses": uses, "tests": tests, "impl": impl, "rule": rule}


SERVICES = ["OrderService", "InvoiceService", "ReminderService"]
hard = [F("Program", "root", SERVICES, 0), F("OrderService", "policy", ["SmtpMailer", "SqlDatabase"], 4, "", True),
        F("InvoiceService", "policy", ["SmtpMailer", "SqlDatabase"], 3), F("ReminderService", "policy", ["SmtpMailer"], 2),
        F("SmtpMailer", "infra", [], 1), F("SqlDatabase", "infra", [], 1)]
concrete = [F("Program", "root", SERVICES + ["SmtpMailer", "SqlDatabase"], 0)] + hard[1:]  # same files, but handed in
owned = [concrete[0], F("OrderService", "policy", ["Notifier", "OrderStore"], 4, "", True), F("InvoiceService", "policy", ["Notifier", "OrderStore"], 3),
         F("ReminderService", "policy", ["Notifier"], 2), F("Notifier", "interface", [], 0), F("OrderStore", "interface", [], 0),
         F("SmtpMailer", "infra", [], 1, "Notifier"), F("SqlDatabase", "infra", [], 1, "OrderStore")]
everything = [F("Program", "root", SERVICES + ["SmtpMailer", "SqlDatabase", "SystemClock", "OrderValidator", "PriceCalculator", "Money"], 0),
              F("OrderService", "policy", ["Notifier", "OrderStore", "IValidator", "IPriceCalculator", "IClock"], 4),
              F("InvoiceService", "policy", ["Notifier", "OrderStore", "IMoney", "IClock"], 3), F("ReminderService", "policy", ["Notifier", "IClock"], 2),
              *owned[4:], F("IClock", "interface", [], 0), F("SystemClock", "helper", [], 1, "IClock"), F("IValidator", "interface", [], 0),
              F("OrderValidator", "helper", [], 1, "IValidator"), F("IPriceCalculator", "interface", [], 0),
              F("PriceCalculator", "helper", ["IMoney"], 2, "IPriceCalculator", True), F("IMoney", "interface", [], 0), F("Money", "helper", [], 1, "IMoney")]
DESIGNS = [("hard-wired", hard), ("DI of concrete types", concrete), ("owned abstraction", owned), ("interface for everything", everything)]


def get(d, n):
    return next((f for f in d if f["name"] == n), None)


def users_of(d, n):
    return [f["name"] for f in d if n in f["uses"]]


def users_closure(d, names):  # every file that depends, directly or not, on one of names
    out, todo = list(dict.fromkeys(names)), list(names)
    while todo:
        for u in users_of(d, todo.pop()):
            if u not in out:
                out.append(u)
                todo.append(u)
    return out


# A test needs real infrastructure when its subject reaches a concrete infra class without passing an interface.
# (Subclass-mocking a concrete class is possible, but it keeps the test tied to the detail, so it is not counted.)
def reaches_infra(d, n):
    f = get(d, n)
    return f["kind"] == "infra" or (f["kind"] != "interface" and any(reaches_infra(d, u) for u in f["uses"]))


# Files a reader opens on the longest call path from OrderService to a target (or to any leaf): an interface leads on to its implementers.
def layers(d, n, targets):
    f = get(d, n)
    nxt = f["uses"] + ([x["name"] for x in d if x["impl"] == n] if f["kind"] == "interface" else [])
    here = (0 if nxt else 1) if targets is None else (1 if n in targets else 0)
    deeper = [x + 1 for x in (layers(d, m, targets) for m in nxt) if x > 0]
    return max([here] + deeper + [0])


def change(d, kind):
    after = d
    if kind == "swap":  # the new provider has a different API: whoever names the old class directly must change
        touched = ["SendGridMailer"] + users_of(d, "SmtpMailer")
        after = [dict(f, uses=["SendGridMailer" if u == "SmtpMailer" else u for u in f["uses"]]) for f in d if f["name"] != "SmtpMailer"]
        after.append(F("SendGridMailer", "infra", [], 1, get(d, "SmtpMailer")["impl"]))
    elif kind == "test":
        touched = ["NewOrderServiceTest"]
        after = [dict(f, tests=f["tests"] + 1) if f["name"] == "OrderService" else f for f in d]
    else:  # the rule needs one more input: across an interface the signature changes too, and so do its callers
        home = next(f for f in d if f["rule"])
        iface = get(d, home["impl"]) if home["impl"] else None
        touched = [home["name"]] + ([iface["name"]] + users_of(d, iface["name"]) if iface else [])
    if kind == "test":
        rerun = 1
    else:
        rerun = sum(get(d, n)["tests"] for n in users_closure(d, [n for n in touched if get(d, n)])) + (1 if kind == "swap" else 0)
    focus = ["SendGridMailer"] if kind == "swap" else [next(f for f in d if f["rule"])["name"]] if kind == "rule" else None
    return {"touched": touched, "policy": len([n for n in touched if get(after, n) and get(after, n)["kind"] == "policy"]), "rerun": rerun,
            "infra": sum(f["tests"] for f in after if reaches_infra(after, f["name"])), "layers": layers(after, "OrderService", focus)}


NAMES = {"swap": "swap the mail provider", "test": "add one test of OrderService", "rule": "change the high-level rule"}
for label, d in DESIGNS:
    print(f"-- {label}: {len(d)} files, {sum(f['tests'] for f in d)} tests")
    for kind in ["swap", "test", "rule"]:
        r = change(d, kind)
        print(f"  {NAMES[kind]}: touches {len(r['touched'])} ({', '.join(r['touched'])}); policy files {r['policy']}; tests re-run {r['rerun']}; tests needing real infra {r['infra']}; layers {r['layers']}")
