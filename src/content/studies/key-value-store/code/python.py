# A replicated key-value store with tunable quorums in Python:
# keys are placed on a hash ring, each key lives on N nodes, a write waits for W of them and a read asks R of them.
import sys
from dataclasses import dataclass, field
from itertools import combinations

N = 3  # copies of every key
TOKENS_PER_NODE = 16  # virtual nodes on the ring per server


def fnv_hash(text):  # FNV-1a: a small, fast, well-spread hash
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


@dataclass
class Token:
    at: int
    name: str


@dataclass
class Entry:
    value: str
    version: int


@dataclass
class Node:
    up: bool = True
    data: dict = field(default_factory=dict)


class Ring:
    def __init__(self, names, tokens_per_node=TOKENS_PER_NODE):
        self.tokens = [Token(fnv_hash(f'{name}#{i}'), name) for name in names for i in range(tokens_per_node)]
        self.tokens.sort(key=lambda t: t.at)

    # Walk clockwise from the key's position and collect the first N different nodes.
    def preference_list(self, key):
        h = fnv_hash(key)
        i = next((idx for idx, t in enumerate(self.tokens) if t.at >= h), 0)
        out = []
        for step in range(len(self.tokens)):
            if len(out) >= N:
                break
            name = self.tokens[(i + step) % len(self.tokens)].name
            if name not in out:
                out.append(name)
        return out


def version_of(entry):
    return entry.version if entry else 0


class Cluster:
    def __init__(self, names):
        self.ring = Ring(names)
        self.nodes = {n: Node() for n in names}
        self.clock = 0  # a version number that only grows (real systems use vector clocks or timestamps)

    def put(self, key, value, w):
        self.clock += 1
        version = self.clock
        acks = 0
        for name in self.ring.preference_list(key):
            node = self.nodes[name]
            if not node.up:
                continue  # a node that is down simply misses this write
            node.data[key] = Entry(value, version)
            acks += 1
        if acks < w:
            raise RuntimeError(f'only {acks} of the {w} required replicas answered')
        return version

    # Ask the given replicas and return the newest answer, without changing anything.
    def read(self, key, ask):
        answers = [(n, self.nodes[n].data.get(key)) for n in ask]
        newest = answers[0]
        for a in answers[1:]:
            if version_of(a[1]) > version_of(newest[1]):
                newest = a
        return answers, newest[1]

    # Ask R replicas (the first R that are up) and return the newest answer, then fix any replica that answered with old data.
    def get(self, key, r):
        ask = [n for n in self.ring.preference_list(key) if self.nodes[n].up][:r]
        if len(ask) < r:
            raise RuntimeError('not enough replicas are up')
        answers, newest = self.read(key, ask)
        if newest:
            for n, entry in answers:
                if version_of(entry) < newest.version:
                    self.nodes[n].data[key] = newest  # read repair
        return newest.value if newest else None


def run(w, r):
    cluster = Cluster(['A', 'B', 'C', 'D', 'E'])
    key = 'user:42'
    replicas = cluster.ring.preference_list(key)
    cluster.put(key, 'old', N)  # everything is in sync
    cluster.nodes[replicas[2]].up = False  # one replica goes down...
    try:
        cluster.put(key, 'new', w)  # ...and misses this write; asking for W=3 then fails
    except RuntimeError as e:
        return {'replicas': replicas, 'rejected': str(e)}
    cluster.nodes[replicas[2]].up = True  # it comes back, still holding the old value
    choices = list(combinations(replicas, r))  # every way of choosing r replicas to ask
    newest_values = [cluster.read(key, ask)[1] for ask in choices]
    stale = sum(1 for e in newest_values if (e.value if e else None) != 'new')
    return {'replicas': replicas, 'stale': stale, 'total': len(choices)}


wrong = 0
for w, r in [(2, 2), (3, 1), (1, 1)]:
    res = run(w, r)
    strong = w + r > N
    label = f"N={N} W={w} R={r} ({'W+R>N' if strong else 'W+R<=N'})  replicas {','.join(res['replicas'])}"
    if 'rejected' in res:
        print(f"{label}  write rejected while one replica is down: {res['rejected']}")
        if w < N:
            wrong += 1
        continue
    print(f"{label}  stale reads: {res['stale']} of {res['total']} possible choices")
    if strong and res['stale'] > 0:
        wrong += 1  # overlapping quorums must never return old data
    if not strong and res['stale'] == 0:
        wrong += 1  # and without overlap, stale data must be possible
if wrong:
    sys.exit(1)
