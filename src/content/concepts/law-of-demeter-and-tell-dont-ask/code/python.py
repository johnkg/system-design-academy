# Law of Demeter and Tell, Don't Ask. Part 1 runs real objects (Order, Customer, Address, Country) through a change: customers get a
# separate shipping address, and the old `address` becomes the billing one. Call sites that reach through the chain keep compiling
# and silently charge the wrong tax; the one that tells the order what to do is fixed in one place. Part 2 counts what each design
# makes you edit for four change requests, from a small model of a codebase: 12 call sites, 4 classes, 8 pieces of data.
# Look for: 190 vs 200, and how the edits spread (7 modules vs 1 class), and the price of forwarding everything.


class Country:
    def __init__(self, name, rate):
        self.name, self.rate = name, rate

    def tax_on(self, amount):
        return amount * self.rate // 100


class Address:
    def __init__(self, street, country):
        self.street, self.country = street, country

    def tax_on(self, amount):
        return self.country.tax_on(amount)


class Customer:
    def __init__(self, name, address, shipping=None):
        self.name = name
        self.address = address  # v1: the only address; v2: kept for old code, now means "billing"
        self.shipping = shipping or address

    def tax_on(self, amount):  # the one place that knows which address tax follows
        return self.shipping.tax_on(amount)


class Order:
    def __init__(self, customer, total):
        self.customer, self.total = customer, total

    def tax(self):  # tell, don't ask: the order answers, callers do not navigate
        return self.customer.tax_on(self.total)


# Call sites written the train-wreck way: each one reaches through four objects.
def checkout_tax(order):
    return order.total * order.customer.address.country.rate // 100


def quote_tax(order):
    return order.total * order.customer.address.country.rate // 100


DE, FR = Country("DE", 19), Country("FR", 20)
v1 = Order(Customer("ann", Address("1 Main St", DE)), 1000)
print(f"v1, one address (DE): checkout {checkout_tax(v1)}, quote {quote_tax(v1)}, order.tax() {v1.tax()}")
v2 = Order(Customer("ann", Address("1 Main St", DE), Address("2 Rue Neuve", FR)), 1000)
print(f"v2, billing DE, shipping FR: checkout {checkout_tax(v2)}, quote {quote_tax(v2)}, order.tax() {v2.tax()}")

# Part 2. A model of the codebase. Classes form a chain; each piece of data lives in one class (its owner).
CLASSES = ["Order", "Customer", "Address", "Country"]
OWNER = [1, 1, 2, 2, 3, 3, 3, 3]  # name, tier, street, city, country name, tax rate, zone, code
SITES = [("email", 0), ("invoice", 0), ("loyalty", 1), ("shipping", 2), ("shipping", 3), ("invoice", 4),
         ("report", 4), ("checkout", 5), ("quote", 5), ("shipping", 6), ("fraud", 7), ("export", 2)]  # (module, data it reads)
TELL = [("greeting", [0], 1), ("standing", [1], 1), ("label", [2, 3, 4], 2),
        ("tax", [5], 3), ("zone", [6], 3), ("risk", [7], 3)]  # (method, data it reads, class where it lives)


def units(design):
    # A unit is one piece of code that can need editing: (where, links of the chain it crosses, data whose rule it holds).
    u = []
    if design == "train":  # every call site walks the chain itself
        for m, op in SITES:
            u.append((m, set(range(1, OWNER[op] + 1)), {op}))
    elif design == "forward":  # every class forwards every leaf below it; call sites still decide what to do with the data
        for m, op in SITES:
            u.append((m, set(), {op}))
        for op in range(8):
            for c in range(OWNER[op] + 1):
                u.append((CLASSES[c], {c + 1} if c < OWNER[op] else set(), set()))
    else:  # tell: one method per behaviour, living where its data is, with one-line hops above it
        for m, op in SITES:
            u.append((m, set(), set()))
        for name, reads, home in TELL:
            top = max(OWNER[o] for o in reads)
            for c in range(home + 1):
                u.append((CLASSES[c], {c + 1} if c < home else set(range(home + 1, top + 1)), set(reads) if c == home else set()))
    return u


CHANGES = [("Customer gets several addresses", "shape", 2), ("Address keeps its country as a code", "shape", 3),
           ("Tax rule changes", "rule", 5), ("Country gets a currency", "new", 3)]


def edited(design, kind, arg):
    if kind == "new":  # a new site, plus a hop in every class on the way down (none for the train wreck)
        return ["checkout"] + ([] if design == "train" else CLASSES[: arg + 1])
    if kind == "shape":
        return [w for w, links, logic in units(design) if arg in links]
    return [w for w, links, logic in units(design) if arg in logic]


FORWARDERS = {"train": 0, "tell": sum(h for _, _, h in TELL), "forward": sum(OWNER)}
ORDER_METHODS = {"train": 0, "tell": len(TELL), "forward": len(OWNER)}
for design in ["train", "tell", "forward"]:
    row, edits, places = [], 0, 0
    for name, kind, arg in CHANGES:
        e = edited(design, kind, arg)
        edits += len(e)
        places += len(set(e))
        row.append(f"edits {len(e)} places {len(set(e))}")
    print(f"{design}: {' | '.join(row)} | total {edits} edits, {places} places | order methods {ORDER_METHODS[design]}, "
          f"forwarding-only methods {FORWARDERS[design]}")
