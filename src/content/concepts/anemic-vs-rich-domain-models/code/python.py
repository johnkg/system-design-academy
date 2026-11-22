# Anemic vs rich domain models: an Order with four rules (ship only when paid, ship only when not empty, no items added
# after shipping, discount at most 50%), built three ways. Five code paths each try all four forbidden changes (20 attempts).
# Three paths go through the OrderService (checkout, REST controller, nightly job); two write fields directly (support
# admin tool, CSV import job). Look for: how many forbidden changes get in, how many places a new rule must be written,
# and what a plain lookup table (Country) costs when it is given the same treatment as the Order.
FORBIDDEN = ["ship an unpaid order", "ship an empty order", "add an item to a shipped order", "give an 80% discount"]
CALLERS = [
    ("Checkout service", False), ("REST controller", False), ("Support admin tool", True),
    ("CSV import job", True), ("Nightly job", False),
]


class AnemicOrder:  # fields only
    def __init__(self):
        self.items = []
        self.paid = False
        self.shipped = False
        self.discount = 0


class OrderService:  # the rules live in the service
    def add_item(self, o, i):
        if o.shipped:
            raise Exception("shipped")
        o.items.append(i)

    def pay(self, o):
        o.paid = True

    def ship(self, o):
        if not o.paid:
            raise Exception("unpaid")
        if len(o.items) == 0:
            raise Exception("empty")
        o.shipped = True

    def apply_discount(self, o, p):
        if p > 50:
            raise Exception("too high")
        o.discount = p


class RichOrder:  # the rules live in the object, and the fields are only reachable through its methods
    def __init__(self):
        self._items, self._paid, self._shipped, self._discount = [], False, False, 0

    def add_item(self, i):
        if self._shipped:
            raise Exception("shipped")
        self._items.append(i)

    def pay(self):
        self._paid = True

    def ship(self):
        if not self._paid:
            raise Exception("unpaid")
        if len(self._items) == 0:
            raise Exception("empty")
        self._shipped = True

    def apply_discount(self, p):
        if p > 50:
            raise Exception("too high")
        self._discount = p


class EverywhereOrder(RichOrder):  # rich everywhere: persistence and email are behaviour of the entity too
    def __init__(self, db, mailer):
        super().__init__()
        if not db or not mailer:
            raise Exception("needs a database and a mailer")
        self.db, self.mailer = db, mailer

    def save(self): self.db.write()
    def email_receipt(self): self.mailer.send()
    def render_invoice(self): return "html"


svc = OrderService()


def anemic_order(k):
    """An order in the state a given forbidden change needs, built only through legal operations."""
    o = AnemicOrder()
    if k != 1: svc.add_item(o, "a")
    if k != 0: svc.pay(o)
    if k == 2: svc.ship(o)
    return o


def rich_order(k, make):
    o = make()
    if k != 1: o.add_item("a")
    if k != 0: o.pay()
    if k == 2: o.ship()
    return o


class Stub:
    def write(self): pass
    def send(self): pass


def attempt(design, direct, k):
    """True when the forbidden change got in."""
    try:
        if design == 0:
            o = anemic_order(k)
            if not direct:
                if k < 2: svc.ship(o)
                elif k == 2: svc.add_item(o, "b")
                else: svc.apply_discount(o, 80)
            elif k < 2: o.shipped = True
            elif k == 2: o.items.append("b")
            else: o.discount = 80
        else:
            o = rich_order(k, (lambda: RichOrder()) if design == 1 else (lambda: EverywhereOrder(Stub(), Stub())))
            if k < 2: o.ship()
            elif k == 2: o.add_item("b")
            else: o.apply_discount(80)
        return True
    except Exception:
        return False


DESIGNS = [
    ("Anemic: fields plus a service", lambda: ["OrderService"] + [n for n, d in CALLERS if d],
     2, "Country (2 fields) and a repository with find and save", 0),
    ("Rich where rules exist", lambda: ["Order"],
     2, "Country (2 fields) and a repository with find and save: nothing to protect, so nothing added", 0),
    ("Rich everywhere", lambda: ["Order"],
     8, "Country with validate, rename, equals, display, save and load on top of find and save", 2),
]

for d, (name, where, methods, note, needs) in enumerate(DESIGNS):
    accepted, through = 0, []
    for cname, direct in CALLERS:
        for k in range(len(FORBIDDEN)):
            if attempt(d, direct, k):
                accepted += 1
                if cname not in through:
                    through.append(cname)
    print(f"== {name}")
    suffix = f" (got in through: {', '.join(through)})" if accepted else ""
    print(f"  forbidden changes accepted: {accepted} of {len(CALLERS) * len(FORBIDDEN)}{suffix}")
    print(f"  new rule \"no discount on a shipped order\": places to write it {len(where())} ({', '.join(where())})")
    print(f"  collaborators needed to test one rule: {needs}")
    print(f"  plain lookup table (Country): methods written {methods}, rules protected 0 ({note})")
