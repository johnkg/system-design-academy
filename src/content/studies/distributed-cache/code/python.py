# A cache cluster in Python, in four small parts:
# 1) a consistent-hash ring with virtual nodes, 2) an LRU cache with a memory limit and TTLs,
# 3) single flight against a stampede, 4) TTL jitter against a mass expiry.
import bisect
import sys

M = 0xFFFFFFFF


def hash32(s):
    """A 32-bit hash: FNV-1a, then a final mix so that similar strings land far apart."""
    h = 0x811C9DC5
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & M
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & M
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & M
    h ^= h >> 16
    return h


class Ring:
    def __init__(self, node_count, vnodes):
        # (position on the ring, node), sorted by position
        self.points = sorted((hash32(f"node{n}#{v}"), n) for n in range(node_count) for v in range(vnodes))
        self.positions = [p[0] for p in self.points]

    def owner(self, key):
        """The first point clockwise from the key, wrapping around."""
        i = bisect.bisect_left(self.positions, hash32(key))
        return self.points[i % len(self.points)][1]


class Cache:
    """An LRU cache with a limit on the number of entries and a time to live. A dict keeps insertion order, so the first key is the oldest use."""

    def __init__(self, capacity):
        self.capacity = capacity
        self.map = {}
        self.evicted = []

    def get(self, key, now):
        e = self.map.pop(key, None)
        if e is None:
            return None
        if e[1] <= now:
            return None  # expired: behaves as a miss
        self.map[key] = e  # a use moves it to the newest end
        return e[0]

    def set(self, key, value, now, ttl):
        self.map.pop(key, None)
        self.map[key] = (value, now + ttl)
        while len(self.map) > self.capacity:
            oldest = next(iter(self.map))
            del self.map[oldest]
            self.evicted.append(oldest)


def stampede(single_flight):
    """A key expires at 100 ms; one request per millisecond arrives until 200 ms, and a database load takes 40 ms."""
    loads, ready, started = 0, float("inf"), False
    for t in range(100, 200):
        if t >= ready:
            continue  # refilled: a hit
        if single_flight and started:
            continue  # waits for the load already running
        loads += 1
        started = True
        ready = min(ready, t + 40)
    return loads


def peak(keys, jitter):
    per_second = {}
    for k in keys[:1000]:
        ttl = 300000 + ((hash32(k) % 60000) - 30000 if jitter else 0)  # +/- 10%
        s = ttl // 1000
        per_second[s] = per_second.get(s, 0) + 1
    return max(per_second.values())


keys = [f"user:{i}" for i in range(10000)]

ring4, ring5 = Ring(4, 100), Ring(5, 100)
load = [0, 0, 0, 0]
before = []
for k in keys:
    n = ring4.owner(k)
    load[n] += 1
    before.append(n)
print("keys per node on 4 nodes x 100 vnodes: " + ", ".join(str(x) for x in load))
moved, to_new, mod_moved = 0, True, 0
for k, b in zip(keys, before):
    after = ring5.owner(k)
    if after != b:
        moved += 1
        if after != 4:
            to_new = False
    if hash32(k) % 4 != hash32(k) % 5:
        mod_moved += 1
print(f"adding a 5th node moves {moved} keys on the ring, all to the new node: {str(to_new).lower()}; hash mod N would move {mod_moved}")

cache = Cache(3)
cache.set("a", 1, 0, 100)
cache.set("b", 2, 0, 100)
cache.set("c", 3, 0, 100)
cache.get("a", 10)  # a is now the newest, so b is the oldest
cache.set("d", 4, 20, 100)  # over the limit: b is evicted


def shown(v):
    return "miss" if v is None else v


print(f"evicted: {','.join(cache.evicted)}; a={shown(cache.get('a', 30))}, b={shown(cache.get('b', 30))}; a after its TTL={shown(cache.get('a', 150))}")

plain, single = stampede(False), stampede(True)
print(f"database loads while refilling: {plain} without protection, {single} with single flight")

flat, spread = peak(keys, False), peak(keys, True)
print(f"1000 keys cached together: most expiries in one second is {flat} without jitter, {spread} with it")

ok = (to_new and moved < 3000 and mod_moved > 7000 and min(load) > 2000 and plain == 40 and single == 1
      and flat == 1000 and spread < 50 and ",".join(cache.evicted) == "b" and cache.get("b", 30) is None)
if not ok:
    sys.exit(1)
