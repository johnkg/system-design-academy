# A tiny serverless platform, in Python:
# every instance runs one request at a time, the router reuses a warm idle instance or starts a cold one (if the cap allows),
# idle instances are reaped after a timeout, and provisioned instances stay for ever.
import sys

MS_PER_S = 1000
SECONDS = 600  # ten minutes of traffic
SEED = 7
STEADY_RATE = 40  # requests per second
BURST_PERIOD = 90  # bursty: 150 rps for 8 s every 90 s, 15 rps otherwise
BURST_LEN = 8
BURST_RATE = 150
QUIET_RATE = 15
SPIKE_LEN = 6  # spiky: 250 rps for 6 s at each spike start, silence otherwise
SPIKE_RATE = 250
MIN_RUN_MS = 50  # a request runs 50..149 ms
RUN_SPREAD_MS = 100
MS_PER_MICRO = 60  # price: one millionth of a dollar per 60 billed ms, per 240 provisioned ms and per 5 requests
PROVISIONED_MS_PER_MICRO = 240
REQUESTS_PER_MICRO = 5
COST_RATIO = 3  # provisioned concurrency must cost at least this many times more

END = SECONDS * MS_PER_S  # in milliseconds
SPIKE_STARTS = (30, 270, 510)
KEPT_FIRST = 10**12  # ranks provisioned instances above any busy-until time
seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Requests per second for each pattern. Every request has a start time and a run time of 50 to 149 ms.
def traffic(pattern):
    global seed
    seed = SEED
    requests = []
    for s in range(SECONDS):
        rate = STEADY_RATE  # steady
        if pattern == 'bursty':
            rate = BURST_RATE if s % BURST_PERIOD < BURST_LEN else QUIET_RATE
        if pattern == 'spiky':
            rate = SPIKE_RATE if any(a <= s < a + SPIKE_LEN for a in SPIKE_STARTS) else 0
        for _ in range(rate):
            t = s * MS_PER_S + random(MS_PER_S)
            ms = MIN_RUN_MS + random(RUN_SPREAD_MS)
            requests.append((t, len(requests), ms))
    requests.sort()
    return [{'t': t, 'ms': ms} for t, _, ms in requests]


def run(requests, idle_seconds, provisioned, init_ms, cap):
    idle = idle_seconds * MS_PER_S
    pool = [{'busy_until': 0, 'kept': True} for _ in range(provisioned)]
    cold = throttled = billed_ms = idle_ms = 0
    peak = provisioned
    latencies = []
    for r in requests:
        # Reap on-demand instances that have been idle for longer than the timeout.
        alive = []
        for x in pool:
            dead = not x['kept'] and x['busy_until'] <= r['t'] and x['busy_until'] + idle < r['t']
            if dead:
                idle_ms += idle
            else:
                alive.append(x)
        pool = alive
        # Prefer a free provisioned instance, then the most recently used free one (so the others can go idle and be reaped).
        best = None
        for x in pool:
            if x['busy_until'] <= r['t'] and (best is None or rank(x) > rank(best)):
                best = x
        if best is not None:
            if not best['kept']:
                idle_ms += r['t'] - best['busy_until']
            best['busy_until'] = r['t'] + r['ms']
            latencies.append(r['ms'])
            billed_ms += r['ms']
        elif len(pool) < cap:  # scale from zero: a new instance pays the start before it runs
            cold += 1
            pool.append({'busy_until': r['t'] + init_ms + r['ms'], 'kept': False})
            latencies.append(init_ms + r['ms'])
            billed_ms += init_ms + r['ms']
            peak = max(peak, len(pool))
        else:  # at the cap: rejected
            throttled += 1
    for x in pool:
        if not x['kept']:
            idle_ms += max(0, min(idle, END - x['busy_until']))
    latencies.sort()

    def pct(p):  # nearest rank
        return latencies[(len(latencies) * p + 99) // 100 - 1]

    cost_micro = billed_ms // MS_PER_MICRO + (provisioned * END) // PROVISIONED_MS_PER_MICRO + len(latencies) // REQUESTS_PER_MICRO  # millionths of a dollar
    return {'cold': cold, 'throttled': throttled, 'served': len(latencies), 'peak': peak, 'p50': pct(50), 'p95': pct(95), 'p99': pct(99),
            'billed_ms': billed_ms, 'idle_seconds': idle_ms // MS_PER_S, 'cost_micro': cost_micro}


def rank(x):
    return (KEPT_FIRST if x['kept'] else 0) + x['busy_until']


def show(label, cfg, r):
    idle_seconds, provisioned, init_ms, cap = cfg
    print(f"{label} (idle {idle_seconds} s, provisioned {provisioned}, init {init_ms} ms, cap {cap}): cold {r['cold']}, throttled {r['throttled']}, "
          f"p50/p95/p99 {r['p50']}/{r['p95']}/{r['p99']} ms, billed {r['billed_ms']} ms, warm idle {r['idle_seconds']} s, cost {r['cost_micro']} micro-dollars")


base = (60, 0, 800, 100)  # idle seconds, provisioned, init ms, cap
requests = {}
for pattern in ('steady', 'bursty', 'spiky'):
    requests[pattern] = traffic(pattern)
    r = run(requests[pattern], *base)
    show(f"{pattern:<6} {len(requests[pattern])} requests", base, r)
    if r['served'] + r['throttled'] != len(requests[pattern]) or r['peak'] > base[3]:
        sys.exit(1)

print('--- the same spiky traffic with one change at a time')
spiky = requests['spiky']
results = {}
changes = [('baseline', base), ('longer idle timeout', (240, 0, 800, 100)), ('provisioned 30', (60, 30, 800, 100)),
           ('faster init', (60, 0, 200, 100)), ('higher cap', (60, 0, 800, 300))]
for name, cfg in changes:
    results[name] = run(spiky, *cfg)
    show(f"{name:<19}", cfg, results[name])
b = results['baseline']
ok = (b['throttled'] > 0 and b['cold'] > 0
      and results['longer idle timeout']['cold'] < b['cold']  # survives the 234 s of silence
      and results['higher cap']['throttled'] < b['throttled']
      and results['faster init']['p99'] < b['p99']
      and results['provisioned 30']['cost_micro'] > COST_RATIO * b['cost_micro'])  # paying all day for a 6-second spike
print(f"each change helps what it should, and provisioned concurrency costs more: {'true' if ok else 'false'}")
if not ok:
    sys.exit(1)
