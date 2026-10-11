# G-Counter, PN-Counter and OR-Set as state-based CRDTs, plus a naive last-write-wins counter for contrast.
# merge() is commutative, associative and idempotent, so any delivery order, with duplicates, converges.
from itertools import permutations

IDS = "ABC"


class LWWCounter:  # naive: one number and a timestamp, newest write wins
    def __init__(self, v=10, ts=0, by=0): self.v, self.ts, self.by = v, ts, by
    def inc(self, r, ts): self.v, self.ts, self.by = self.v + 1, ts, r
    def dec(self, r, ts): self.v, self.ts, self.by = self.v - 1, ts, r
    def merge(self, o):
        w = o if (o.ts, o.by) > (self.ts, self.by) else self
        return LWWCounter(w.v, w.ts, w.by)
    def value(self): return self.v
    def key(self): return f"{self.v}@{self.ts}"
    def size(self): return 2


class GCounter:  # one slot per replica, merge = element-wise max
    def __init__(self, p=None): self.p = list(p or [4, 3, 3])
    def inc(self, r, ts): self.p[r] += 1
    def merge(self, o): return GCounter([max(a, b) for a, b in zip(self.p, o.p)])
    def value(self): return sum(self.p)
    def key(self): return "[" + ",".join(map(str, self.p)) + "]"
    def size(self): return len(self.p)


class PNCounter:  # two G-Counters: increments and decrements
    def __init__(self, p=None, n=None): self.p, self.n = list(p or [4, 3, 3]), list(n or [0, 0, 0])
    def inc(self, r, ts): self.p[r] += 1
    def dec(self, r, ts): self.n[r] += 1
    def merge(self, o):
        return PNCounter([max(a, b) for a, b in zip(self.p, o.p)], [max(a, b) for a, b in zip(self.n, o.n)])
    def value(self): return sum(self.p) - sum(self.n)
    def key(self): return "P[" + ",".join(map(str, self.p)) + "]N[" + ",".join(map(str, self.n)) + "]"
    def size(self): return len(self.p) + len(self.n)


class ORSet:  # adds carry unique tags; remove tombstones only the tags it has observed
    def __init__(self, adds=None, rem=None, seq=0):
        self.adds, self.rem, self.seq = dict(adds or {"A0": "urgent"}), set(rem or ()), seq
    def add(self, r, el):
        self.adds[f"{IDS[r]}{self.seq}"] = el
        self.seq += 1
    def remove(self, r, el):
        self.rem |= {t for t, e in self.adds.items() if e == el}
    def merge(self, o): return ORSet({**self.adds, **o.adds}, self.rem | o.rem, self.seq)
    def value(self): return ",".join(sorted({e for t, e in self.adds.items() if t not in self.rem}))
    def key(self): return ";".join(sorted(f"{t}={e}" for t, e in self.adds.items())) + "|" + ",".join(sorted(self.rem))
    def size(self): return len(self.adds) + len(self.rem)


def counters(cls, with_dec):
    reps = [cls(), cls(), cls()]
    script = [(0, 1), (1, 1), (2, 1), (0, 1), (1, 1), (2, 1), (0, 1), (1, 1), (1, 1), (1, 1), (2, 1), (2, -1)]
    for i, (r, d) in enumerate(script):
        if d > 0: reps[r].inc(r, (i + 1) * 100)
        elif with_dec: reps[r].dec(r, (i + 1) * 100)
    return reps, 10 + sum(d for _, d in script if d > 0 or with_dec)


def sets(cls, _):
    reps = [cls(), cls(), cls()]
    reps[0].remove(0, "urgent")  # A removes the tag it has seen...
    reps[1].add(1, "urgent")     # ...while B concurrently adds it again, under a new unique tag
    reps[2].add(2, "billing")
    return reps, None


def converge(name, cls, build, with_dec=True):
    keys, values, sizes = set(), set(), set()
    for perm in permutations(range(3)):  # 6 merge orders
        reps, expected = build(cls, with_dec)
        snaps = [r.merge(r) for r in reps]  # copies, replayed later as stale messages
        for _ in range(2):  # every pull is delivered twice
            for i in perm:
                for j in perm:
                    if i != j: reps[i] = reps[i].merge(reps[j])
        before = [r.key() for r in reps]
        for i in range(3):
            for s in snaps: reps[i] = reps[i].merge(s)
        assert before == [r.key() for r in reps], "stale replay changed a state"
        assert len({r.key() for r in reps}) == 1, "replicas diverged"
        keys.add(reps[0].key()); values.add(reps[0].value()); sizes.add(reps[0].size())
    assert len(keys) == 1, "order changed the result"
    value = values.pop()
    print(f"{name}: 6 orders x duplicates -> {value} state={keys.pop()} size={sizes.pop()} expected={expected if expected is not None else '-'}")
    return value, expected


v, e = converge("G-Counter ", GCounter, counters, with_dec=False)
assert v == e == 21
v, e = converge("PN-Counter", PNCounter, counters)
assert v == e == 20
v, e = converge("LWW counter", LWWCounter, counters)
print(f"  naive LWW shows {v} instead of {e}: {e - v} increments lost")
assert v == 12 and e - v == 8
v, _ = converge("OR-Set    ", ORSet, sets)
assert v == "billing,urgent"  # B's concurrent add survives A's remove: add wins

s = ORSet(seq=1)  # A already used tag A0 for the first 'urgent'
for i in range(5):
    s.add(0, "vip"); s.remove(0, "vip")
print(f"OR-Set after 5 add/remove cycles: value='{s.value()}' size={s.size()} (tombstones grow until garbage collected)")
assert s.value() == "urgent" and s.size() == 11
