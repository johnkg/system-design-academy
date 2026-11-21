# Design by contract and defensive programming. An order goes through four layers (api, service, pricing, ledger). The same 20
# requests run through five designs: no checks, check everything everywhere, a contract (validate user input at the boundary,
# one postcondition inside), the same contract with assertions switched off, and silent repair (clamp bad values and go on).
# Every check is counted. 14 requests are fine, 4 carry bad user input (a quantity outside 1..100) and 2 hit a bug in our own
# service (a legacy path multiplies the price by 100 by mistake). Look for: where each design catches things, how many
# checks it pays for, and which designs let a wrong record through. Part 2 runs the same model on 100 requests.
LIMIT = 100000
LAYERS = ["api", "service", "pricing", "ledger"]
checks = 0


def check(ok):  # every condition a design evaluates goes through here, so the cost is visible
    global checks
    checks += 1
    return ok


def valid_all(qty, price):  # three conditions, stops at the first one that fails
    return check(1 <= qty <= 100) and check(0 <= price <= 10000) and check(0 <= qty * price <= LIMIT)


def clamp_all(qty, price):  # three "checks" that repair instead of rejecting
    global checks
    checks += 3
    return min(max(qty, 1), 100), min(max(price, 0), 10000)


def api(design, qty, price, legacy, internals):
    if design == "everywhere" and not valid_all(qty, price):
        return ("error", "api")
    if design == "contract":  # precondition on user input: the caller (the outside world) must supply a sane order
        if not (check(1 <= qty <= 100) and check(0 <= price <= 10000)):
            return ("error", "api")
    if design == "repair":
        qty, price = clamp_all(qty, price)
    return service(design, qty, price, legacy, internals)


def service(design, qty, price, legacy, internals):
    if design == "everywhere" and not valid_all(qty, price):
        return ("error", "service")
    if design == "repair":
        qty, price = clamp_all(qty, price)
    if legacy:
        price = price * 100  # the bug: the legacy path mixes up units
    return pricing(design, qty, price, internals)


def pricing(design, qty, price, internals):
    global checks
    if design == "everywhere" and not valid_all(qty, price):
        return ("error", "pricing")
    if design == "repair":
        checks += 3
        qty, price = min(max(qty, 1), 100), min(max(price, 0), 10000)
        return ledger(design, min(max(qty * price, 0), LIMIT), qty, price)
    total = qty * price
    if design == "contract" and internals and not check(0 <= total <= LIMIT):  # postcondition of pricing
        return ("error", "pricing")
    return ledger(design, total, qty, price)


def ledger(design, total, qty, price):
    if design == "everywhere" and not valid_all(qty, price):
        return ("error", "ledger")
    if design == "repair":
        clamp_all(qty, price)
    return ("record", total)


VALID = [(2, 300), (1, 1500), (10, 250), (5, 999), (3, 4500), (40, 120), (7, 700), (12, 800), (1, 10000), (25, 400), (100, 1000),
         (6, 350), (8, 2200), (15, 640)]
USER = [(0, 200), (-3, 500), (500, 20), (101, 50)]
BUG = [(20, 150), (5, 400)]
REQUESTS = [(q, p, 0, "ok") for q, p in VALID] + [(q, p, 0, "user") for q, p in USER] + [(q, p, 1, "bug") for q, p in BUG]

DESIGNS = [("trust", "trust", True), ("everywhere", "everywhere", True), ("contract", "contract", True),
           ("contract, assertions off", "contract", False), ("repair", "repair", True)]
REAL = {}
for label, design, internals in DESIGNS:
    checks = 0
    tally = {"correct": 0, "rejected": 0, "failed loudly": 0, "wrong": 0}
    where = {name: 0 for name in LAYERS}
    for qty, price, legacy, kind in REQUESTS:
        expected = None if kind == "user" else qty * price
        res = api(design, qty, price, legacy, internals)
        if res[0] == "record":
            tally["correct" if res[1] == expected else "wrong"] += 1
        else:
            tally["rejected" if expected is None else "failed loudly"] += 1
            where[res[1]] += 1
    REAL[label] = (tally["correct"], tally["rejected"], tally["failed loudly"], tally["wrong"], checks)
    stops = ", ".join(f"{n} {where[n]}" for n in LAYERS if where[n])
    print(f"{label}: correct {tally['correct']}, rejected {tally['rejected']}, failed loudly {tally['failed loudly']}, "
          f"wrong {tally['wrong']}, checks {checks}, stopped at: {stops or 'nowhere'}")

# Part 2. The same model as counts, checked against the run above, then for 100 requests with u% bad user input and b% bugs of our own.
# checks: everywhere 12 per good request, 1 for a rejected one, 8 for a bug (api 3, service 3, pricing 2); contract 3, 1, 3;
# contract with assertions off 2, 1, 2; repair 12 for every request; trust none.
def model(design, u, b, internals, n=100):
    user, bug = n * u // 100, n * b // 100
    ok = n - user - bug
    if design == "trust":
        return dict(correct=ok, rejected=0, loud=0, wrong=user + bug, checks=0)
    if design == "everywhere":
        return dict(correct=ok, rejected=user, loud=bug, wrong=0, checks=ok * 12 + user + bug * 8)
    if design == "contract" and internals:
        return dict(correct=ok, rejected=user, loud=bug, wrong=0, checks=ok * 3 + user + bug * 3)
    if design == "contract":
        return dict(correct=ok, rejected=user, loud=0, wrong=bug, checks=ok * 2 + user + bug * 2)
    return dict(correct=ok, rejected=0, loud=0, wrong=user + bug, checks=n * 12)


same = all((lambda r: (r["correct"], r["rejected"], r["loud"], r["wrong"], r["checks"]))(model(d, 20, 10, i, 20)) == REAL[lbl]
           for lbl, d, i in DESIGNS)
print(f"the model gives the same counts as the run: {str(same).lower()}")
for u, b in [(0, 0), (20, 10), (40, 20)]:
    for label, design, internals in DESIGNS:
        r = model(design, u, b, internals)
        print(f"{u}% bad input, {b}% bugs, {label}: correct {r['correct']}, wrong {r['wrong']}, checks {r['checks']}")
