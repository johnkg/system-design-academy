# Consistent hashing in Python: a hash ring with virtual nodes.
import json
from bisect import bisect_left


def hash32(text):  # FNV-1a followed by a bit mixer, so similar strings land far apart
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & 0xFFFFFFFF
    h ^= h >> 16
    return h


class HashRing:
    def __init__(self, virtual_nodes=100):
        self._points = []  # (pos, node) sorted by position around the ring
        self.virtual_nodes = virtual_nodes

    def add_node(self, name):
        for i in range(self.virtual_nodes):
            self._points.append((hash32(f"{name}#{i}"), name))
        self._points.sort(key=lambda p: p[0])

    def remove_node(self, name):
        self._points = [p for p in self._points if p[1] != name]

    def node_for(self, key):  # first point at or after the key's position, wrapping past the end
        h = hash32(str(key))
        lo = bisect_left(self._points, h, key=lambda p: p[0])
        return self._points[lo % len(self._points)][1]


KEY_COUNT = 10000
VIRTUAL_NODES = 100  # ring points per physical node
INITIAL_NODES = ["A", "B", "C"]
keys = [f"key-{i}" for i in range(KEY_COUNT)]
ring = HashRing(VIRTUAL_NODES)
for n in INITIAL_NODES:
    ring.add_node(n)

before = {k: ring.node_for(k) for k in keys}
load = {}
for node in before.values():
    load[node] = load.get(node, 0) + 1
print("keys per node:", json.dumps(load, separators=(",", ":")))

ring.add_node("D")
moved_ring = sum(1 for k in keys if before[k] != ring.node_for(k))
moved_mod = sum(1 for k in keys if hash32(k) % len(INITIAL_NODES) != hash32(k) % (len(INITIAL_NODES) + 1))
print(f"adding a 4th node moves {100 * moved_ring / KEY_COUNT:.1f}% of keys on the ring, {100 * moved_mod / KEY_COUNT:.1f}% with hash mod N")
