# A chaos experiment runner, in Python:
# inject a fault into a small slice of a simulated fleet, watch the steady-state metric every tick,
# refuse experiments above the blast-radius limit, and abort and roll back when a guardrail is breached.
import sys

N, REQUESTS, CAPACITY, TICKS, START = 10, 100, 15, 20, 5  # 10 instances, 100 requests per tick
STEADY, GUARD, DETECT = 50, 100, 2                         # error rates in requests per thousand
PER_MILLE = 1000

seed = 7


# 32-bit LCG (Numerical Recipes constants)
def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def run(exp):
    if exp['targets'] > exp['limit']:
        return {'status': 'rejected', 'max_pm': 0, 'aborted_at': -1, 'restored': True}
    dead, eject_at, err_pct, cap = [False] * N, [0] * N, [0] * N, [CAPACITY] * N
    cursor, max_pm, violated = 0, 0, False
    for t in range(TICKS):
        if t == START:
            for i in range(exp['targets']):
                if exp['kind'] == 'kill':
                    dead[i] = True
                    eject_at[i] = t + DETECT
                elif exp['kind'] == 'errors':
                    err_pct[i] = exp['value']
                else:
                    cap[i] = exp['value']  # slow: the instance can serve only a few requests per tick
        rotation = [i for i in range(N) if not (dead[i] and t >= eject_at[i])]  # the load balancer drops dead instances after a delay
        load = [0] * N

        def attempt(i):
            if dead[i] or load[i] >= cap[i]:
                return False
            load[i] += 1
            return not (err_pct[i] > 0 and random(100) < err_pct[i])

        errors = 0
        for _ in range(REQUESTS):
            ok = attempt(rotation[cursor % len(rotation)])
            cursor += 1
            if not ok:
                ok = attempt(rotation[cursor % len(rotation)])  # the client retries once
                cursor += 1
            if not ok:
                errors += 1
        pm = errors * PER_MILLE // REQUESTS
        if t >= START:
            max_pm = max(max_pm, pm)
            if pm > STEADY:
                violated = True
            if pm > GUARD:  # guardrail breached: stop injecting and restore everything
                dead, err_pct, cap = [False] * N, [0] * N, [CAPACITY] * N
                restored = not any(dead) and all(e == 0 for e in err_pct) and all(c == CAPACITY for c in cap)
                return {'status': 'aborted', 'max_pm': max_pm, 'aborted_at': t, 'restored': restored}
    return {'status': 'hypothesis disproved' if violated else 'hypothesis held', 'max_pm': max_pm, 'aborted_at': -1, 'restored': True}


experiments = [
    {'name': 'errors on 2 instances', 'kind': 'errors', 'targets': 2, 'value': 30, 'limit': 3},
    {'name': 'slow 3 instances', 'kind': 'slow', 'targets': 3, 'value': 5, 'limit': 3},
    {'name': 'kill 5 instances', 'kind': 'kill', 'targets': 5, 'value': 0, 'limit': 5},
    {'name': 'kill 8 instances', 'kind': 'kill', 'targets': 8, 'value': 0, 'limit': 3},
]
results = [(e, run(e)) for e in experiments]
for e, r in results:
    aborted = f", aborted at tick {r['aborted_at']}" if r['aborted_at'] >= 0 else ''
    print(f"{e['name']}: {r['status']}, worst {r['max_pm']} per thousand{aborted}")
by = {e['kind'] + str(e['targets']): r for e, r in results}
ok = (by['errors2']['status'] == 'hypothesis held' and by['kill8']['status'] == 'rejected'
      and by['kill5']['status'] == 'aborted' and all(r['restored'] for _, r in results))
print(f"blast radius enforced, guardrail aborted the kill, fleet restored: {str(ok).lower()}")
if not ok:
    sys.exit(1)
