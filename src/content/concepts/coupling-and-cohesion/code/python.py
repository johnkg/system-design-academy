# Coupling and cohesion. Part 1 reads a customer's country three ways (through shared global state, by reaching through
# strangers, through a narrow method) and counts the calls in each chain (the Law of Demeter). Part 2 is a model of one checkout
# feature built four ways, as a module graph whose edges have a coupling kind; for three change requests it counts the other
# modules that must change and the modules and responsibilities to re-test. Look for: the chain lengths, and what a one-module
# design does to "modules that change" and to the size of what is re-tested.
calls = 0  # every call the reading code makes on an object; the hand-offs Cart makes inside shipping_country() are Cart's own business and are not counted


def counted(f):
    def wrapper(*args):
        global calls
        calls += 1
        return f(*args)

    return wrapper


class Address:
    def __init__(self, country):
        self._country = country

    @counted
    def get_country(self):
        return self._country

    def country(self):
        return self._country


class Customer:
    def __init__(self, address):
        self._address = address

    @counted
    def get_address(self):
        return self._address

    def country(self):
        return self._address.country()


class Cart:  # a cart may know its own customer; callers should not have to
    def __init__(self, customer):
        self._customer = customer

    @counted
    def get_customer(self):
        return self._customer

    @counted
    def shipping_country(self):
        return self._customer.country()  # narrow: asks Customer, which asks Address; no private field is read


class State:
    def __init__(self, cart):
        self._cart = cart

    @counted
    def get_cart(self):
        return self._cart


cart = Cart(Customer(Address("DE")))
GLOBAL = State(cart)
for label, read in [
    ("shared global state", lambda: GLOBAL.get_cart().get_customer().get_address().get_country()),
    ("reaching through strangers", lambda: cart.get_customer().get_address().get_country()),
    ("narrow interface", lambda: cart.shipping_country()),
]:
    calls = 0
    country = read()
    print(f"{label}: {country} after {calls} call{'' if calls == 1 else 's'}")

# Part 2: the module graph. An edge a -> b means a depends on b, with a kind from loosest to tightest.
WEIGHT = {"data": 1, "stamp": 2, "control": 3, "common": 4, "content": 5}
# A change reaches a dependent only through an edge at least this tight: an internal rewrite (level 1) is seen only by modules
# that reach into internals, a change of a data structure (level 2) by those that share or pass the structure around, a change
# of an operation's signature (level 3) by every caller. A module that has to change absorbs it and does not pass it on.
THRESHOLD = {1: 5, 2: 2, 3: 1}
NAMES = ["Checkout", "Cart", "Pricing", "Inventory", "Billing", "Notifications", "Reports"]
mods = [{"name": n, "has": [n]} for n in NAMES]
FLOW = [("Checkout", "Cart"), ("Checkout", "Pricing"), ("Checkout", "Inventory"), ("Checkout", "Billing"), ("Checkout", "Notifications"),
        ("Pricing", "Cart"), ("Inventory", "Cart"), ("Billing", "Pricing"), ("Notifications", "Billing"), ("Notifications", "Cart"),
        ("Reports", "Cart"), ("Reports", "Pricing"), ("Reports", "Inventory"), ("Reports", "Billing")]
DESIGNS = [
    ("shared global state", mods, [(a, b, "common") for a, b in FLOW]),
    ("reaching into internals", mods, [(a, b, "content") for a, b in FLOW]),
    ("narrow interfaces", mods, [("Checkout", "Cart", "data"), ("Checkout", "Pricing", "stamp"), ("Checkout", "Inventory", "data"), ("Checkout", "Billing", "data"),
                                 ("Checkout", "Notifications", "control"), ("Reports", "Checkout", "stamp")]),
    ("one big module", [{"name": "Monolith", "has": NAMES}], []),
]
CHANGES = [("add a currency field to the price structure", "Pricing", 2), ("rewrite how stock is reserved (internal)", "Inventory", 1),
           ("change the signature of the charge call", "Billing", 3)]


def blast(mods, edges, resp, level):
    home = next(m["name"] for m in mods if resp in m["has"])
    change = [home]
    for a, b, kind in edges:
        if b == home and WEIGHT[kind] >= THRESHOLD[level] and a not in change:
            change.append(a)
    retest = list(change)
    for a, b, kind in edges:
        if b in change and a not in retest:
            retest.append(a)
    size = {m["name"]: len(m["has"]) for m in mods}
    return change, retest, sum(size[n] for n in retest)


for label, ms, edges in DESIGNS:
    score = sum(WEIGHT[k] for _, _, k in edges)
    biggest = max(len(m["has"]) for m in ms)
    print(f"-- {label}: {len(edges)} dependencies, coupling score {score}, largest module holds {biggest} responsibilities")
    for text, resp, level in CHANGES:
        change, retest, resp_n = blast(ms, edges, resp, level)
        print(f"  {text}: {len(change) - 1} other modules must change ({', '.join(change[1:]) or 'none'}); {len(retest)} modules and {resp_n} responsibilities re-tested")
