# Dependency injection: an order service that charges a card, sends an email and reads the clock, built four ways.
# A shared "world" counts how many REAL side effects were reached; a good test reaches none.
# Look for: what a test can replace, what happens when a test forgets one fake, and what adding a fourth dependency
# costs. A missing dependency is reported when the object is built; in a compiled language this would be a compile
# error for constructor injection, here it is an explicit check at construction time.
world = {"charges": 0, "mails": 0, "clock": 0}


def reset():
    world["charges"] = world["mails"] = world["clock"] = 0


class RealGateway:
    def charge(self, amount): world["charges"] += 1


class RealMailer:
    def send(self, to): world["mails"] += 1


class RealClock:
    def now(self):
        world["clock"] += 1
        return 1


class FakeGateway:
    def charge(self, amount): pass


class FakeMailer:
    def send(self, to): pass


class FakeClock:
    def now(self): return 1


def real():
    return {"gateway": RealGateway(), "mailer": RealMailer(), "clock": RealClock()}


def fake():
    return {"gateway": FakeGateway(), "mailer": FakeMailer(), "clock": FakeClock()}


def run(g, m, c):
    g.charge(50)
    m.send("a@example.com")
    c.now()


def need(deps, names):
    for n in names:
        if n not in deps:
            raise Exception(f"missing {n}")


class Hardcoded:  # builds its own collaborators: nothing can be replaced
    def checkout(self):
        r = real()
        run(r["gateway"], r["mailer"], r["clock"])


class Injected:  # constructor injection: the three needs are the constructor parameters
    def __init__(self, deps):
        need(deps, ["gateway", "mailer", "clock"])
        self.d = deps

    def checkout(self):
        run(self.d["gateway"], self.d["mailer"], self.d["clock"])


locator = {"registry": {}}  # global registry, filled with the production objects


def reset_locator():
    locator["registry"] = real()


class Located:  # asks the global registry for what it needs: the constructor says nothing
    def checkout(self):
        r = locator["registry"]
        run(r["gateway"], r["mailer"], r["clock"])


NINE = ["gateway", "mailer", "clock", "logger", "ids", "formatter", "rounding", "retry", "metrics"]


class OverInjected:  # a container wires nine collaborators, six of them trivial helpers a test never replaces
    def __init__(self, deps):
        need(deps, NINE)
        self.d = deps

    def checkout(self):
        run(self.d["gateway"], self.d["mailer"], self.d["clock"])


def nine_fakes(skip):
    f = fake()
    for n in NINE[3:]:
        f[n] = object()
    if skip:
        del f[skip]
    return f


def make_hardcoded(skip):
    return 0, lambda: Hardcoded()


def make_injected(skip):
    f = fake()
    if skip:
        del f[skip]
    return (2 if skip else 3), lambda: Injected(f)


def make_located(skip):
    f = fake()
    if skip:
        del f[skip]

    def build():
        reset_locator()
        locator["registry"].update(f)
        if skip:
            locator["registry"][skip] = real()[skip]
        return Located()

    return (2 if skip else 3), build


def make_over(skip):
    return (8 if skip else 9), lambda: OverInjected(nine_fakes(skip))


DESIGNS = [
    ("Built inside (new, or a global)", 0, make_hardcoded),
    ("Constructor injection", 3, make_injected),
    ("Service locator", 0, make_located),
    ("Container, everything injected", 9, make_over),
]

# Adding a fourth dependency (a tax calculator) with 1 production construction site and 4 existing tests.
TESTS = 4
ADD = [
    (1, 0, TESTS),                # nothing to edit but the service; every test now reaches the real calculator
    (1 + 1 + TESTS, TESTS, 0),    # service, composition root, each test passes one more fake; tests fail to build until then
    (1 + 1, 0, TESTS),            # service and one registration; tests keep running against the real calculator
    (4 + TESTS, TESTS, 0),        # interface, implementation, registration, service, and a fake in each test
]

for i, (name, params, make) in enumerate(DESIGNS):
    print(f"== {name}")
    reset()
    fakes, build = make(None)
    build().checkout()
    print(f"  test a checkout: fakes the test supplies {fakes}; real effects reached {world['charges'] + world['mails'] + world['clock']} (charges {world['charges']}, emails {world['mails']}, clock reads {world['clock']}); dependencies visible in the signature: {params}")
    reset()
    outcome = "test ran"
    try:
        make("mailer")[1]().checkout()
    except Exception as e:
        outcome = f"failed before running: {e}"
    print(f"  test forgets the mailer fake: {outcome}; real effects reached {world['charges'] + world['mails'] + world['clock']} (emails {world['mails']})")
    files, loud, quiet = ADD[i]
    print(f"  add a fourth dependency: files edited {files}; tests that fail loudly {loud}; tests that quietly use the real thing {quiet}")
