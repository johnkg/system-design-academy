# Domain-driven design: part 1 cuts a shop's "Customer" four ways and applies four changes; part 2 draws aggregate boundaries around five entities.
# Look for: files edited and teams involved per change, tests to run again, and which business rules one transaction can still enforce.
# A file is (name, team, what it holds, data fields it copies, files it imports). A change touches tokens; a file is edited if it holds or copies one.
# Tokens: loyalty, address, payer, requester are the four teams' ideas of "customer"; ".data" is the model's fields, ".rule" is the code using them.


def ctx(name, holds, copies):
    return [
        (name + "Model", name.lower(), holds, copies, []),
        (name + "Acl", name.lower(), [], holds + copies, [name + "Model", "PublishedLanguage"]),  # the translation layer maps shared ids into the context's own model
    ]


DESIGNS = [
    ("One shared model", [
        ("CustomerModel", "shared", ["loyalty.data", "address.data", "payer.data", "requester.data"], [], []),
        ("SalesApp", "sales", ["loyalty.rule"], [], ["CustomerModel"]),
        ("ShippingApp", "shipping", ["address.rule"], [], ["CustomerModel"]),
        ("BillingApp", "billing", ["payer.rule"], [], ["CustomerModel"]),
        ("SupportApp", "support", ["requester.rule"], [], ["CustomerModel"]),
    ]),
    ("Contexts with translation", [
        ("PublishedLanguage", "shared", [], [], []),
        *ctx("Sales", ["loyalty.data"], []),
        *ctx("Shipping", ["address.data"], []),
        *ctx("Billing", ["payer.data"], []),
        *ctx("Support", ["requester.data"], []),
        ("SalesApp", "sales", ["loyalty.rule"], [], ["SalesModel"]),
        ("ShippingApp", "shipping", ["address.rule"], [], ["ShippingModel"]),
        ("BillingApp", "billing", ["payer.rule"], [], ["BillingModel"]),
        ("SupportApp", "support", ["requester.rule"], [], ["SupportModel"]),
    ]),
    ("Contexts reusing upstream types", [
        ("SalesModel", "sales", ["loyalty.data"], [], []),
        ("ShippingModel", "shipping", ["address.data"], [], []),
        ("BillingModel", "billing", ["payer.data"], [], []),
        ("SupportModel", "support", ["requester.data"], [], []),
        ("SalesApp", "sales", ["loyalty.rule"], [], ["SalesModel"]),
        ("ShippingApp", "shipping", ["address.rule"], ["loyalty.data"], ["ShippingModel", "SalesModel"]),  # reads the Sales customer directly
        ("BillingApp", "billing", ["payer.rule"], ["loyalty.data"], ["BillingModel", "SalesModel"]),
        ("SupportApp", "support", ["requester.rule"], ["loyalty.data", "address.data"], ["SupportModel", "SalesModel", "ShippingModel"]),
    ]),
    ("A context per entity", [
        ("PublishedLanguage", "shared", [], [], []),
        *ctx("Loyalty", ["loyalty.data"], []),
        *ctx("Customer", [], ["loyalty.data", "address.data", "payer.data", "requester.data"]),
        *ctx("Address", ["address.data"], []),
        *ctx("Payment", ["payer.data"], []),
        *ctx("Ticket", ["requester.data"], []),
        *ctx("Order", [], ["loyalty.data", "address.data", "payer.data"]),
        ("SalesApp", "sales", ["loyalty.rule"], [], ["LoyaltyModel", "CustomerModel", "OrderModel"]),
        ("ShippingApp", "shipping", ["address.rule"], [], ["AddressModel", "CustomerModel", "OrderModel"]),
        ("BillingApp", "billing", ["payer.rule"], [], ["PaymentModel", "CustomerModel", "OrderModel"]),
        ("SupportApp", "support", ["requester.rule"], [], ["TicketModel", "CustomerModel"]),
    ]),
]

CHANGES = [
    ("Sales adds a loyalty tier", ["loyalty.data", "loyalty.rule"]),
    ("Shipping allows several addresses", ["address.data", "address.rule"]),
    ("Billing separates payer from user", ["payer.data", "payer.rule"]),
    ("Support calls the customer a requester", ["requester.data", "requester.rule"]),
]


def analyse(files, touches):
    def hit(ts):
        return any(t in touches for t in ts)

    edited = [f for f in files if hit(f[2]) or hit(f[3])]
    retest = {f[0] for f in edited}
    grew = True
    while grew:  # anything that imports a retested file must be retested too
        grew = False
        for f in files:
            if f[0] not in retest and any(c in retest for c in f[4]):
                retest.add(f[0])
                grew = True

    def teams_of(names):
        return {f[1] for f in files if f[0] in names}

    return [f[0] for f in edited], len(teams_of({f[0] for f in edited})), len(retest), len(teams_of(retest))


print("Part 1: one word, four meanings")
for name, files in DESIGNS:
    print(f"== {name}: {len(files)} files")
    te = tt = tr = tq = 0
    for i, (text, touches) in enumerate(CHANGES):
        edited, teams, retest, retest_teams = analyse(files, touches)
        print(f"  C{i + 1} {text}: edit {len(edited)} ({', '.join(edited)}); {teams} teams edit; retest {retest} files of {retest_teams} teams")
        te += len(edited)
        tt += teams
        tr += retest
        tq += retest_teams
    print(f"  four changes: {te} files edited, {tt} team-edits, {tr} retests, {tq} team-retests")

# Part 2: aggregates. An invariant can be enforced in one transaction only if all its entities sit in one aggregate.
INVARIANTS = [
    ("order total equals the sum of its lines", ["Order", "Line"]),
    ("a line quantity stays above zero", ["Line"]),
    ("stock never goes below zero", ["Line", "Stock"]),
    ("an order ships only when paid", ["Order", "Payment"]),
    ("open orders stay under the credit limit", ["Customer", "Order"]),
]
AGGREGATES = [
    ("One big aggregate", [["Customer", "Order", "Line", "Payment", "Stock"]]),
    ("Order with its lines", [["Order", "Line"], ["Customer"], ["Payment"], ["Stock"]]),
    ("Every entity alone", [["Customer"], ["Order"], ["Line"], ["Payment"], ["Stock"]]),
]
print("Part 2: aggregates")
for name, groups in AGGREGATES:
    atomic = [i for i in INVARIANTS if any(all(e in g for e in i[1]) for g in groups)]
    biggest = max(len(g) for g in groups)
    print(f"== {name}: aggregates {len(groups)}; rules enforced in one transaction {len(atomic)} of {len(INVARIANTS)}; eventual {len(INVARIANTS) - len(atomic)}; entities locked by the biggest write {biggest}")
