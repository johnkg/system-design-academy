# A client-side mesh proxy in Python: it balances by least request (power of two choices),
# ejects a pod after 5 errors in a row, and retries only while retries stay under 20% of the requests.
import sys

PODS, TICKS, PER_TICK, BAD_POD, BAD_FROM, OUTAGE_FROM, OUTAGE_TO = 5, 300, 2, 3, 50, 200, 220
HOLD = [2, 5, 2, 2, 2]  # ticks a request stays in flight; pod 1 is slow
MAX_RETRIES, EJECT_AFTER, EJECT_TICKS = 3, 5, 30

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


def run(eject, budget):
    global seed
    seed = 7
    active, consecutive, ejected_until, sent = [0] * PODS, [0] * PODS, [0] * PODS, [0] * PODS
    releases = [[] for _ in range(TICKS + 10)]
    r = {"requests": 0, "ok": 0, "attempts": 0, "retries": 0, "ejections": 0, "denied": 0, "bad_before": 0}

    # Power of two choices: draw two candidate pods and take the one with fewer requests in flight.
    def pick(t, tried):
        pool = [p for p in range(PODS) if ejected_until[p] <= t and p not in tried]
        if not pool:
            pool = [p for p in range(PODS) if p not in tried]  # panic mode: use ejected pods too
        a = pool[random(len(pool))]
        b = pool[random(len(pool))]
        return b if active[b] < active[a] else a

    for t in range(TICKS):
        for p in releases[t]:
            active[p] -= 1
        for _ in range(PER_TICK):
            r["requests"] += 1
            tried = []
            for k in range(MAX_RETRIES + 1):
                p = pick(t, tried)
                if p == BAD_POD and BAD_FROM <= t < OUTAGE_FROM:
                    r["bad_before"] += 1  # attempts that reached the bad pod before the outage
                r["attempts"] += 1
                sent[p] += 1
                active[p] += 1
                releases[t + HOLD[p]].append(p)
                down = (OUTAGE_FROM <= t < OUTAGE_TO) or (p == BAD_POD and t >= BAD_FROM)
                if not down:
                    consecutive[p] = 0
                    r["ok"] += 1
                    break
                consecutive[p] += 1
                if eject and consecutive[p] >= EJECT_AFTER:
                    ejected_until[p] = t + EJECT_TICKS
                    consecutive[p] = 0
                    r["ejections"] += 1
                tried.append(p)
                if k == MAX_RETRIES:
                    break
                if budget and (r["retries"] + 1) * 5 > r["requests"]:  # the budget: retries <= 20% of requests
                    r["denied"] += 1
                    break
                r["retries"] += 1
    r["sent"] = sent
    return r


modes = [("plain", False, False), ("eject", True, False), ("budget", False, True), ("eject+budget", True, True)]
result = {}
for name, eject, budget in modes:
    r = run(eject, budget)
    result[name] = r
    print(f"{name.ljust(13)} ok {r['ok']}/{r['requests']}, attempts {r['attempts']}, retries {r['retries']}, denied {r['denied']}, "
          f"ejections {r['ejections']}, per pod [{', '.join(str(x) for x in r['sent'])}]")

plain, eject, budget, both = result["plain"], result["eject"], result["budget"], result["eject+budget"]
print(f"bad pod {BAD_POD} got {plain['bad_before']} attempts before the outage in plain mode and {eject['bad_before']} with ejection")
print(f"amplification: {plain['attempts'] / plain['requests']:.2f} plain, {both['attempts'] / both['requests']:.2f} with ejection and budget")

checks = [
    eject["bad_before"] * 2 < plain["bad_before"],      # ejection stops most traffic to the bad pod
    budget["retries"] * 5 <= budget["requests"],        # the budget bounds retries to 20% of requests
    both["attempts"] < plain["attempts"],               # less wasted work
    plain["ok"] > plain["requests"] * 0.9 and both["ok"] > 0,  # retries still hide the one bad pod
]
if False in checks:
    print("invariant failed", checks)
    sys.exit(1)
