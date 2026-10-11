# A two-level CDN cache (edge PoPs in front of one regional shield) in Python:
# least-recently-used eviction, expiry by TTL, and the choice of joining a fetch that is already under way.
import sys

TTL, EDGE_CAP, SHIELD_CAP, POPS, REQUESTS = 20000, 200, 500, 4, 20000
EDGE_SHIELD, ORIGIN_TRIP, ORIGIN_WORK = 16, 80, 30  # milliseconds: edge to shield and back, origin round trip, origin processing


class Cache:
    def __init__(self, cap):
        self.cap = cap
        self.items = {}
        self.tick = 0
        self.hits = 0
        self.joined = 0
        self.misses = 0

    # Returns how long the caller waits (ms) until the object is available at this level.
    def lookup(self, key, now, coalesce, fetch):
        e = self.items.get(key)
        if e is not None and e['expires'] > now:
            if e['ready'] <= now:                      # fresh copy: a hit
                self.tick += 1
                e['used'] = self.tick
                self.hits += 1
                return 0
            if coalesce:                               # a fetch is under way: wait for it
                self.joined += 1
                return e['ready'] - now
        self.misses += 1
        wait = fetch()                                 # expired, absent, or not joining: fetch again
        self.tick += 1
        self.items[key] = {'ready': now + wait, 'expires': now + wait + TTL, 'used': self.tick}
        while len(self.items) > self.cap:              # evict the least recently used
            oldest = min(self.items, key=lambda k: self.items[k]['used'])
            del self.items[oldest]
        return wait


def simulate(shielded, coalesce):
    state = {'seed': 99, 'origin': 0}

    def next_number():
        state['seed'] = (state['seed'] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state['seed'] >> 8

    def from_origin():
        state['origin'] += 1
        return ORIGIN_TRIP + ORIGIN_WORK

    edges = [Cache(EDGE_CAP) for _ in range(POPS)]
    shield = Cache(SHIELD_CAP)
    now = 0
    total_wait = 0
    for _ in range(REQUESTS):
        now += 1 + next_number() % 3
        u = next_number() % 10000
        key = (u * u * u) // 2000000000                # cubing a uniform number favours low keys: a few popular objects
        edge = edges[next_number() % POPS]
        if shielded:
            total_wait += edge.lookup(key, now, coalesce, lambda: EDGE_SHIELD + shield.lookup(key, now, coalesce, from_origin))
        else:
            total_wait += edge.lookup(key, now, coalesce, from_origin)
    ok = all(len(e.items) <= EDGE_CAP for e in edges) and sum(e.hits + e.joined + e.misses for e in edges) == REQUESTS
    return {'origin': state['origin'], 'hits': sum(e.hits for e in edges), 'joined': sum(e.joined for e in edges), 'wait': total_wait // REQUESTS, 'ok': ok}


# 100 requests for a new object arrive within 100 ms while its fetch takes 110 ms.
def herd(coalesce):
    cache = Cache(10)
    fetches = [0]

    def fetch():
        fetches[0] += 1
        return 110

    for t in range(100):
        cache.lookup(7, t, coalesce, fetch)
    return fetches[0]


runs = []
for shielded, coalesce, name in [(False, False, 'edge only'), (False, True, 'edge only + coalescing'), (True, False, 'edge + shield'), (True, True, 'edge + shield + coalescing')]:
    r = simulate(shielded, coalesce)
    r['name'] = name
    runs.append(r)
for r in runs:
    print(f"{r['name']}: {r['origin']} origin requests, edge hit ratio {r['hits'] * 1000 // REQUESTS} per mille, {r['joined']} joined, average wait {r['wait']} ms")
loose, joined, shielded_run, both = runs
print(f"herd of 100 requests: {herd(False)} origin fetches without coalescing, {herd(True)} with it")
print(f"origin load: {loose['origin']} -> {both['origin']} ({both['origin'] * 100 // loose['origin']}% of the edge-only load)")

good = (all(r['ok'] for r in runs) and joined['origin'] <= loose['origin'] and shielded_run['origin'] < loose['origin']
        and both['origin'] <= shielded_run['origin'] and both['origin'] < loose['origin'] and herd(False) == 100 and herd(True) == 1)
if not good:
    sys.exit(1)
