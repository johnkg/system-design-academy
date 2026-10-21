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


REQUESTS = 400  # checkout requests per period
SAMPLES = 12  # resource samples per period
PAY_SLOWDOWN = 12  # payments_slow multiplies payment latency
BAD_DEPLOY_FAIL_PCT = 25
ERR_JUMP_PM = 50  # diagnosis: an error-rate jump (per mille) that marks a bad build
SLOW_FACTOR = 3  # p99 this many times the healthy p99 is slow
POOL_WAITERS_ALERT = 10  # mean pool waiters that blame the pool
SEED = 7
CONTROL_SEED = 8  # a second healthy period
# Draws as (minimum, spread): a value is minimum + (random % spread).
OWN_MS = (10, 20)  # checkout's own work
PAY_MS = (40, 40)
INV_MS = (15, 15)
DB_MS = (4, 8)
LOCK_WAIT_MS = (600, 400)  # db_lock: extra time per query
POOL_WAIT_MS = (500, 500)  # pool_exhaustion: waiting for a connection
FAST_FAIL_MS = (5, 8)  # bad_deploy: a failed inventory call
POOL_UTIL_PCT = (30, 15)  # resource samples
DB_CPU_PCT = (25, 10)
EXHAUSTED_WAITERS = (20, 10)
EXHAUSTED_CPU_PCT = (15, 5)
LOCKED_WAITERS = (10, 10)
LOCKED_CPU_PCT = (5, 5)


def lcg(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] >> 8  # 24 bits
    return nxt


# One period of 400 checkout requests plus 12 resource samples, with an optional injected fault.
def simulate(fault, seed):
    r = lcg(seed)

    def draw(d):
        return d[0] + r() % d[1]

    events = []  # (svc, dur, ok)
    for _ in range(REQUESTS):
        own = draw(OWN_MS)
        pay, inv, db, pool, ok = draw(PAY_MS), draw(INV_MS), draw(DB_MS), 0, True
        if fault == "payments_slow":
            pay *= PAY_SLOWDOWN
        if fault == "db_lock":
            db += draw(LOCK_WAIT_MS)
        if fault == "pool_exhaustion":
            pool = draw(POOL_WAIT_MS)  # waiting for a connection, not a slow query
        if fault == "bad_deploy" and r() % 100 < BAD_DEPLOY_FAIL_PCT:
            ok = False
            inv = draw(FAST_FAIL_MS)
        if ok:
            events += [("payments", pay, True), ("db", db, True), ("inventory", inv, True), ("checkout", own + pool + pay + inv + db, True)]
        else:  # the bad inventory build fails fast and checkout returns 500 straight away
            events += [("inventory", inv, False), ("checkout", own + inv, False)]
    samples = []  # (pool_util, waiters, cpu)
    for _ in range(SAMPLES):
        pool_util, waiters, cpu = draw(POOL_UTIL_PCT), 0, draw(DB_CPU_PCT)
        if fault == "pool_exhaustion":
            pool_util, waiters = 100, draw(EXHAUSTED_WAITERS)
            cpu = draw(EXHAUSTED_CPU_PCT)  # starved database idles
        if fault == "db_lock":
            pool_util, waiters = 100, draw(LOCKED_WAITERS)
            cpu = draw(LOCKED_CPU_PCT)
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
        if f(d)["errPm"] - h(d)["errPm"] >= ERR_JUMP_PM and f(d)["failP50"] < h(d)["p99"]:
            return d
    for d in DEPS:
        if f(d)["p99"] >= SLOW_FACTOR * h(d)["p99"]:  # a dependency is slow in its own right
            return d
    if f("checkout")["p99"] >= SLOW_FACTOR * h("checkout")["p99"]:
        return "checkout db pool" if u["waiters"] >= POOL_WAITERS_ALERT else "checkout"
    return "none"


healthy = simulate("none", SEED)


def row(name, p):
    c, pay, inv, db, u = red(p[0], "checkout"), red(p[0], "payments"), red(p[0], "inventory"), red(p[0], "db"), use(p[1])
    print(f"{name.ljust(16)} checkout avg={c['avg']} p99={c['p99']} err_pm={c['errPm']} fail_p50={c['failP50']} | pay p99={pay['p99']} | inv err_pm={inv['errPm']} | db p99={db['p99']} | pool util={u['poolUtil']} wait={u['waiters']} dbcpu={u['dbCpu']}")


row("healthy", healthy)
print(f"healthy diagnosis: {diagnose(healthy, simulate('none', CONTROL_SEED))}")

correct = 0
h_avg = red(healthy[0], "checkout")["avg"]
for fault, culprit in FAULTS.items():
    faulty = simulate(fault, SEED)
    row(fault, faulty)
    got = diagnose(healthy, faulty)
    avg_flags = red(faulty[0], "checkout")["avg"] >= 2 * h_avg  # what an average-only dashboard could say
    print(f"  -> blame {got} (expected {culprit}); average-only alarm: {'true' if avg_flags else 'false'}")
    if got == culprit:
        correct += 1
print(f"classified {correct} of 4 faults correctly")
if correct != len(FAULTS) or diagnose(healthy, simulate("none", CONTROL_SEED)) != "none":
    sys.exit(1)
if red(simulate("bad_deploy", SEED)[0], "checkout")["avg"] >= h_avg:
    sys.exit(1)  # the average even improves
