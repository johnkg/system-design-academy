# Fan-out tail latency with and without hedged requests: a deterministic Monte Carlo with integer milliseconds.
# Backend model: 99% of calls take 6..14 ms (mean 10), 1% take 200..1000 ms. Load makes everything slower (M/M/1-style).
import math

TAIL_BP = 100  # 1% in basis points


def lcg(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] >> 8
    return nxt


def tail_bp(s):  # s = slowdown in milli (1000 = nominal)
    return min(5000, TAIL_BP * s // 1000)


def is_tail(r1, s):
    return r1 % 10000 < tail_bp(s)


def latency(r1, r2, r3, s):
    if is_tail(r1, s):
        return 200 + r2 % 801
    return max(1, (6 + r2 % 5 + r3 % 5) * s // 1000)


# Exact percentile of ONE backend's latency (weighted points, no sampling noise): this is where the hedge delay comes from.
def delay_for(pct, s):
    tb = tail_bp(s)
    pts = []
    for a in range(5):
        for b in range(5):
            pts.append(((6 + a + b) * s // 1000, (10000 - tb) * 801))
    for k in range(801):
        pts.append((200 + k, tb * 25))
    pts.sort(key=lambda p: p[0])
    total = 25 * 801 * 10000
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
    for k in range(3):
        r1, r2, r3 = nxt(), nxt(), nxt()
        if k == 0:
            tail1 = is_tail(r1, s)
        t.append(latency(r1, r2, r3, s))
    done = t[0]
    hedges = 0
    st["tokens"] = min(10000, st["tokens"] + 50)  # hedge budget: 5% of calls may hedge (shed the rest)
    k = 1
    while k < R and delay > 0 and done > k * delay:
        if st["budget"] and st["tokens"] < 1000:
            break  # load shedding: no budget, no hedge
        if st["budget"]:
            st["tokens"] -= 1000
        hedges += 1
        done = min(done, k * delay + t[k])
        k += 1
    return done, hedges, tail1


# Load feedback: hedges add traffic, utilisation rises, every backend slows down, more calls pass the delay.
def solve(delay_pct, adaptive, R, rho, budget):
    s, extra = 1000, 0
    if delay_pct == 0:
        return s, 0, extra
    d0 = delay_for(delay_pct, 1000)
    for _ in range(8):
        d = delay_for(delay_pct, s) if adaptive else d0
        nxt = lcg(777)
        st = {"tokens": 0, "budget": budget}
        h = 0
        for _ in range(20000):
            h += shard_call(nxt, st, d, R, s)[1]
        extra = h * 1000 // 20000  # extra requests per 1000 primary calls
        eff_pm = min(980, rho * (1000 + extra) // 100)
        s = (1000 - rho * 10) * 1000 // (1000 - eff_pm)
    return s, (delay_for(delay_pct, s) if adaptive else d0), extra


def run(fanout, delay_pct, R, rho, adaptive=False, budget=False, n=2000):
    s, delay, extra = solve(delay_pct, adaptive, R, rho, budget)
    nxt = lcg(12345)
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
            "hitSlowPct": hit_slow * 100 // n, "extraPm": hedges * 1000 // (n * fanout)}


def show(label, r):
    print(f"{label.ljust(26)} p50={str(r['p50']).rjust(3)} p95={str(r['p95']).rjust(4)} p99={str(r['p99']).rjust(4)} "
          f"hit-slow={str(r['hitSlowPct']).rjust(2)}% hedge-delay={str(r['delay']).rjust(3)}ms extra-load={r['extraPm'] // 10}.{r['extraPm'] % 10}%")


print("1 - 0.99^N: " + ", ".join(f"N={f} {math.floor(100 * (1 - math.pow(0.99, f)))}%" for f in [1, 10, 50, 100]))
off, p95, p50, p95b = run(50, 0, 2, 50), run(50, 95, 2, 50), run(50, 50, 2, 50), run(50, 95, 2, 50, budget=True)
print("fan-out 50 shards, 50% load, 2 replicas")
show("no hedging", off)
show("hedge after p95", p95)
show("hedge after p95 + budget", p95b)
show("hedge after p50", p50)
lone, lone_h = run(1, 0, 2, 50), run(1, 95, 2, 50)
print("fan-out 1")
show("no hedging", lone)
show("hedge after p95", lone_h)
print(f"p95 delay {delay_for(95, 1000)} ms, p50 delay {delay_for(50, 1000)} ms")

assert p95["p99"] < off["p99"], "hedging at p95 must reduce p99"
assert p95["extraPm"] < 100, "hedging at p95 must add under 10% load"
assert p50["extraPm"] > 3 * p95["extraPm"], "hedging at p50 must cost far more than at p95"
assert p95b["extraPm"] <= 50, "the budget must cap the extra load at 5%"
print("invariants hold")
