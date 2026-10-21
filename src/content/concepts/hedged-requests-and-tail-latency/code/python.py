# Fan-out tail latency with and without hedged requests: a deterministic Monte Carlo with integer milliseconds.
# Backend model: 99% of calls take 6..14 ms (mean 10), 1% take 200..1000 ms. Load makes everything slower (M/M/1-style).
import math

TAIL_BP = 100  # 1% in basis points
BP_SCALE = 10000  # basis points in 100%
MILLI = 1000  # slowdown s and loads are in thousandths (1000 = nominal)
MAX_TAIL_BP = 5000  # the slow tail never exceeds half of all calls
FAST_MIN_MS = 6  # fast calls: 6 ms plus two draws of 0..4 ms
FAST_STEPS = 5
TAIL_MIN_MS = 200  # slow calls: 200..1000 ms
TAIL_SPAN = 801
COPIES = 3  # latencies drawn per shard call, one per possible replica
BUDGET_CAP = 10000  # hedge budget in tokens: each call earns 50, a hedge costs 1000, so 5% of calls may hedge
BUDGET_EARN = 50
HEDGE_COST = 1000
SOLVE_ROUNDS = 8  # fixed-point iterations of the load feedback
SOLVE_CALLS = 20000  # shard calls sampled per iteration
SOLVE_SEED = 777
MAX_UTIL_PM = 980  # utilisation is capped at 98%
RUN_SEED = 12345
RUN_CALLS = 2000  # fan-out requests per run
FANOUT = 50  # demo: shards per request, load in percent, replicas per shard
LOAD_PCT = 50
REPLICAS = 2
MAX_HEDGE_LOAD_PM = 100  # hedging at p95 must add under 10% load
P50_COST_RATIO = 3  # hedging at p50 must cost at least this many times more


def lcg(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] >> 8
    return nxt


def tail_bp(s):  # s = slowdown in milli (1000 = nominal)
    return min(MAX_TAIL_BP, TAIL_BP * s // MILLI)


def is_tail(r1, s):
    return r1 % BP_SCALE < tail_bp(s)


def latency(r1, r2, r3, s):
    if is_tail(r1, s):
        return TAIL_MIN_MS + r2 % TAIL_SPAN
    return max(1, (FAST_MIN_MS + r2 % FAST_STEPS + r3 % FAST_STEPS) * s // MILLI)


# Exact percentile of ONE backend's latency (weighted points, no sampling noise): this is where the hedge delay comes from.
def delay_for(pct, s):
    tb = tail_bp(s)
    pts = []
    for a in range(FAST_STEPS):
        for b in range(FAST_STEPS):
            pts.append(((FAST_MIN_MS + a + b) * s // MILLI, (BP_SCALE - tb) * TAIL_SPAN))
    for k in range(TAIL_SPAN):
        pts.append((TAIL_MIN_MS + k, tb * FAST_STEPS * FAST_STEPS))
    pts.sort(key=lambda p: p[0])
    total = FAST_STEPS * FAST_STEPS * TAIL_SPAN * BP_SCALE
    cum = 0
    for v, w in pts:
        cum += w
        if cum * 100 >= pct * total:
            return max(1, v)
    return pts[-1][0]


# One shard call with R replicas. Copy k+1 is sent at k*delay if nothing has answered yet. Returns (latency, hedgesSent, primaryWasSlow).
def shard_call(nxt, st, delay, R, s):
    t = []
    tail1 = False
    for k in range(COPIES):
        r1, r2, r3 = nxt(), nxt(), nxt()
        if k == 0:
            tail1 = is_tail(r1, s)
        t.append(latency(r1, r2, r3, s))
    done = t[0]
    hedges = 0
    st["tokens"] = min(BUDGET_CAP, st["tokens"] + BUDGET_EARN)  # hedge budget: 5% of calls may hedge (shed the rest)
    k = 1
    while k < R and delay > 0 and done > k * delay:
        if st["budget"] and st["tokens"] < HEDGE_COST:
            break  # load shedding: no budget, no hedge
        if st["budget"]:
            st["tokens"] -= HEDGE_COST
        hedges += 1
        done = min(done, k * delay + t[k])
        k += 1
    return done, hedges, tail1


# Load feedback: hedges add traffic, utilisation rises, every backend slows down, more calls pass the delay.
def solve(delay_pct, adaptive, R, rho, budget):
    s, extra = MILLI, 0
    if delay_pct == 0:
        return s, 0, extra
    d0 = delay_for(delay_pct, MILLI)
    for _ in range(SOLVE_ROUNDS):
        d = delay_for(delay_pct, s) if adaptive else d0
        nxt = lcg(SOLVE_SEED)
        st = {"tokens": 0, "budget": budget}
        h = 0
        for _ in range(SOLVE_CALLS):
            h += shard_call(nxt, st, d, R, s)[1]
        extra = h * MILLI // SOLVE_CALLS  # extra requests per 1000 primary calls
        eff_pm = min(MAX_UTIL_PM, rho * (MILLI + extra) // 100)
        s = (MILLI - rho * (MILLI // 100)) * MILLI // (MILLI - eff_pm)
    return s, (delay_for(delay_pct, s) if adaptive else d0), extra


def run(fanout, delay_pct, R, rho, adaptive=False, budget=False, n=RUN_CALLS):
    s, delay, extra = solve(delay_pct, adaptive, R, rho, budget)
    nxt = lcg(RUN_SEED)
    st = {"tokens": 0, "budget": budget}
    lat = []
    hedges = hit_slow = 0
    for _ in range(n):
        worst, slow = 0, False
        for _ in range(fanout):
            l, h, t = shard_call(nxt, st, delay, R, s)
            worst = max(worst, l)
            hedges += h
            slow = slow or t
        lat.append(worst)
        hit_slow += 1 if slow else 0
    lat.sort()

    def pct(p):
        return lat[(p * n + 99) // 100 - 1]
    return {"p50": pct(50), "p95": pct(95), "p99": pct(99), "delay": delay, "s": s,
            "hitSlowPct": hit_slow * 100 // n, "extraPm": hedges * MILLI // (n * fanout)}


def show(label, r):
    print(f"{label.ljust(26)} p50={str(r['p50']).rjust(3)} p95={str(r['p95']).rjust(4)} p99={str(r['p99']).rjust(4)} "
          f"hit-slow={str(r['hitSlowPct']).rjust(2)}% hedge-delay={str(r['delay']).rjust(3)}ms extra-load={r['extraPm'] // 10}.{r['extraPm'] % 10}%")


print("1 - 0.99^N: " + ", ".join(f"N={f} {math.floor(100 * (1 - math.pow(0.99, f)))}%" for f in [1, 10, 50, 100]))
off, p95, p50, p95b = run(FANOUT, 0, REPLICAS, LOAD_PCT), run(FANOUT, 95, REPLICAS, LOAD_PCT), run(FANOUT, 50, REPLICAS, LOAD_PCT), run(FANOUT, 95, REPLICAS, LOAD_PCT, budget=True)
print("fan-out 50 shards, 50% load, 2 replicas")
show("no hedging", off)
show("hedge after p95", p95)
show("hedge after p95 + budget", p95b)
show("hedge after p50", p50)
lone, lone_h = run(1, 0, REPLICAS, LOAD_PCT), run(1, 95, REPLICAS, LOAD_PCT)
print("fan-out 1")
show("no hedging", lone)
show("hedge after p95", lone_h)
print(f"p95 delay {delay_for(95, MILLI)} ms, p50 delay {delay_for(50, MILLI)} ms")

assert p95["p99"] < off["p99"], "hedging at p95 must reduce p99"
assert p95["extraPm"] < MAX_HEDGE_LOAD_PM, "hedging at p95 must add under 10% load"
assert p50["extraPm"] > P50_COST_RATIO * p95["extraPm"], "hedging at p50 must cost far more than at p95"
assert p95b["extraPm"] <= BUDGET_EARN * MILLI // HEDGE_COST, "the budget must cap the extra load at 5%"
print("invariants hold")
