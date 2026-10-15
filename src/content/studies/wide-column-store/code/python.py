# A tiny Cassandra-style cluster in Python: a consistent-hash ring with virtual nodes,
# replication factor 3, quorum reads and writes, hinted handoff, read repair and tombstones.
from collections import Counter
RF, NAMES = 3, ["n0", "n1", "n2", "n3", "n4"]

def fnv1a(s):  # 32-bit FNV-1a, integer maths only
    h = 2166136261
    for b in s.encode():
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    h ^= h >> 15
    h = (h * 2246822519) & 0xFFFFFFFF  # finalizer: FNV-1a alone spreads similar keys poorly
    return h ^ (h >> 13)

class Ring:
    def __init__(self, vnodes):
        self.tokens = sorted((fnv1a(f"{n}#{v}"), n) for n in NAMES for v in range(vnodes))
    def replicas(self, key):  # walk clockwise from the key's position and collect RF distinct nodes
        h = fnv1a(key)
        i = next((j for j, t in enumerate(self.tokens) if t[0] >= h), 0)
        order = self.tokens[i:] + self.tokens[:i]
        return list(dict.fromkeys(n for _, n in order))[:RF]

def spread(vnodes):  # how many of 1000 keys each node is the first replica for
    ring = Ring(vnodes)
    return list(Counter(ring.replicas(f"k{i}")[0] for i in range(1000)).values())

class Cluster:
    def __init__(self):
        self.ring, self.up, self.hints = Ring(16), set(NAMES), []
        self.data = {n: {} for n in NAMES}
    def apply(self, node, key, cell):  # last write wins
        cur = self.data[node].get(key)
        if cur is None or cell[0] > cur[0]:
            self.data[node][key] = cell
    def write(self, key, value, ts, w):  # a delete is a write of value None, a tombstone
        acks = 0
        for n in self.ring.replicas(key):
            if n in self.up:
                self.apply(n, key, (ts, value))
                acks += 1
            else:
                self.hints.append((n, key, (ts, value)))  # hinted handoff
        return acks >= w
    def replay(self, node):
        mine = [h for h in self.hints if h[0] == node]
        self.hints = [h for h in self.hints if h[0] != node]
        for _, key, cell in mine:
            self.apply(node, key, cell)
        return len(mine)
    def read(self, key, r):
        live = [n for n in self.ring.replicas(key) if n in self.up]
        if len(live) < r:
            raise RuntimeError("not enough replicas for this read")
        cells = [self.data[n].get(key) for n in live]
        newest = max((c for c in cells if c), key=lambda c: c[0])
        stale = [n for n, c in zip(live, cells) if c is None or c[0] < newest[0]]
        for n in stale:
            self.apply(n, key, newest)  # read repair
        return newest[1], len(stale)
    def purge(self, before):  # compaction drops tombstones older than the grace period
        for n, m in self.data.items():
            self.data[n] = {k: c for k, c in m.items() if c[1] is not None or c[0] >= before}


s1, s64 = spread(1), spread(64)
gap = lambda a: max(a) - min(a)
print(f"1 vnode: busiest {max(s1)}, quietest {min(s1)}; 64 vnodes: busiest {max(s64)}, quietest {min(s64)}")
assert gap(s64) < gap(s1)

for w in range(1, RF + 1):
    for r in range(1, RF + 1):  # worst case: the read set and write set overlap as little as possible
        f = Cluster()
        rs = f.ring.replicas("x")
        for i, n in enumerate(rs):
            f.apply(n, "x", (2, "new") if i < w else (1, "old"))
        sees = any(f.data[n]["x"][1] == "new" for n in rs[RF - r:])
        print(f"W={w} R={r} reads the new value: {str(sees).lower()}")
        assert sees == (r + w > RF)
c, key = Cluster(), "user:42"
down = c.ring.replicas(key)[2]
print(f"{key} lives on {', '.join(c.ring.replicas(key))}")
c.write(key, "v1", 1, 2)
c.up.discard(down)
ok = c.write(key, "v2", 2, 2)
print(f"{down} down: write ok={str(ok).lower()}, hints={len(c.hints)}, read={c.read(key, 2)[0]}")
c.up.add(down)
print(f"{down} back: replayed {c.replay(down)} hint, it holds {c.data[down][key][1]}")
c.up.discard(down)
c.write(key, "v3", 3, 2)
c.hints = []  # the hint expires before the node returns
c.up.add(down)
value, repairs = c.read(key, 2)
print(f"hint lost: read={value}, repairs={repairs}, {down} now holds {c.data[down][key][1]}")
assert value == "v3" and repairs == 1

def delete_while_down(k, purge):  # the third replica misses the delete
    third = c.ring.replicas(k)[2]
    c.write(k, "v3", 3, 3)
    c.up.discard(third)
    c.write(k, None, 4, 2)
    c.hints = []
    if purge:
        c.purge(5)
    c.up.add(third)
    value, repairs = c.read(k, 3)
    return f"{k} purge={str(purge).lower()}: read={'deleted' if value is None else value}, repairs={repairs}"

kept, zombie = delete_while_down("user:7", False), delete_while_down("user:8", True)
print(kept + "\n" + zombie)
assert "deleted" in kept and "read=v3" in zombie
