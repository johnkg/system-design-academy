"""RED and USE summaries from a seeded event stream, and a rule that names the failing component.
Integers only, so Python, C# and JavaScript print exactly the same text."""
import sys

DEPS = ["payments", "inventory", "db"]
FAULTS = {
    "payments_slow": "payments",
    "db_lock": "db",
    "pool_exhaustion": "checkout db pool",
    "bad_deploy": "inventory",
}


def lcg(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] >> 8  # 24 bits
    return nxt


# One period of 400 checkout requests plus 12 resource samples, with an optional injected fault.
def simulate(fault, seed):
    r = lcg(seed)
    events = []  # (svc, dur, ok)
    for _ in range(400):
        own = 10 + r() % 20
        pay, inv, db, pool, ok = 40 + r() % 40, 15 + r() % 15, 4 + r() % 8, 0, True
        if fault == "payments_slow":
            pay *= 12
        if fault == "db_lock":
            db += 600 + r() % 400
        if fault == "pool_exhaustion":
            pool = 500 + r() % 500  # waiting for a connection, not a slow query
        if fault == "bad_deploy" and r() % 100 < 25:
            ok = False
            inv = 5 + r() % 8
        if ok:
            events += [("payments", pay, True), ("db", db, True), ("inventory", inv, True), ("checkout", own + pool + pay + inv + db, True)]
        else:  # the bad inventory build fails fast and checkout returns 500 straight away
            events += [("inventory", inv, False), ("checkout", own + inv, False)]
    samples = []  # (pool_util, waiters, cpu)
    for _ in range(12):
        pool_util, waiters, cpu = 30 + r() % 15, 0, 25 + r() % 10
        if fault == "pool_exhaustion":
            pool_util, waiters = 100, 20 + r() % 10
            cpu = 15 + r() % 5  # starved database idles
        if fault == "db_lock":
            pool_util, waiters = 100, 10 + r() % 10
            cpu = 5 + r() % 5
        samples.append((pool_util, waiters, cpu))
    return events, samples


def percentile(sorted_values, p):  # nearest rank
    return sorted_values[(p * len(sorted_values) + 99) // 100 - 1]


def mean(xs):
    return sum(xs) // len(xs) if xs else 0


# RED per service: Rate (calls), Errors (per mille), Duration (p99 of successes, p50 of failures kept apart).
def red(events, svc):
    mine = [e for e in events if e[0] == svc]
    ok = sorted(e[1] for e in mine if e[2])
    bad = sorted(e[1] for e in mine if not e[2])
    return {
        "rate": len(mine),
        "errPm": len(bad) * 1000 // len(mine),
        "p99": percentile(ok, 99) if ok else 0,
        "failP50": percentile(bad, 50) if bad else 0,
        "avg": mean([e[1] for e in mine]),
    }


# USE for the connection pool and the database host.
def use(samples):
    return {"poolUtil": mean([s[0] for s in samples]), "waiters": mean([s[1] for s in samples]), "dbCpu": mean([s[2] for s in samples])}


# The rule: start at the symptom, walk down to the deepest component that is itself abnormal.
def diagnose(healthy, faulty):
    h = lambda s: red(healthy[0], s)
    f = lambda s: red(faulty[0], s)
    u = use(faulty[1])
    for d in DEPS:  # fast failures: a bad build, not a slow dependency
        if f(d)["errPm"] - h(d)["errPm"] >= 50 and f(d)["failP50"] < h(d)["p99"]:
            return d
    for d in DEPS:
        if f(d)["p99"] >= 3 * h(d)["p99"]:  # a dependency is slow in its own right
            return d
    if f("checkout")["p99"] >= 3 * h("checkout")["p99"]:
        return "checkout db pool" if u["waiters"] >= 10 else "checkout"
    return "none"


healthy = simulate("none", 7)


def row(name, p):
    c, pay, inv, db, u = red(p[0], "checkout"), red(p[0], "payments"), red(p[0], "inventory"), red(p[0], "db"), use(p[1])
    print(f"{name.ljust(16)} checkout avg={c['avg']} p99={c['p99']} err_pm={c['errPm']} fail_p50={c['failP50']} | pay p99={pay['p99']} | inv err_pm={inv['errPm']} | db p99={db['p99']} | pool util={u['poolUtil']} wait={u['waiters']} dbcpu={u['dbCpu']}")


row("healthy", healthy)
print(f"healthy diagnosis: {diagnose(healthy, simulate('none', 8))}")

correct = 0
h_avg = red(healthy[0], "checkout")["avg"]
for fault, culprit in FAULTS.items():
    faulty = simulate(fault, 7)
    row(fault, faulty)
    got = diagnose(healthy, faulty)
    avg_flags = red(faulty[0], "checkout")["avg"] >= 2 * h_avg  # what an average-only dashboard could say
    print(f"  -> blame {got} (expected {culprit}); average-only alarm: {'true' if avg_flags else 'false'}")
    if got == culprit:
        correct += 1
print(f"classified {correct} of 4 faults correctly")
if correct != 4 or diagnose(healthy, simulate("none", 8)) != "none":
    sys.exit(1)
if red(simulate("bad_deploy", 7)[0], "checkout")["avg"] >= h_avg:
    sys.exit(1)  # the average even improves
