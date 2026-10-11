# A lineage catalog in Python: idempotent ingestion of run events, a graph walked downstream for impact analysis,
# owners to notify, and a search that ranks by how much depends on an asset.
import sys


class Catalog:
    def __init__(self):
        self.seen = set()
        self.edges = []
        self.down = {}
        self.up = {}

    @staticmethod
    def link(mapping, a, b):
        mapping.setdefault(a, []).append(b)

    def ingest(self, ev):
        """One run event says which assets a job read and wrote. A repeated event id is ignored."""
        if ev["id"] in self.seen:
            return False
        self.seen.add(ev["id"])
        for out in ev["outputs"]:
            for inp in ev["inputs"]:
                if out in self.down.get(inp, []):
                    continue  # the edge is already known
                self.edges.append((inp, out))
                self.link(self.down, inp, out)
                self.link(self.up, out, inp)
        return True

    def reach(self, mapping, start, max_depth):
        """Breadth-first walk with a depth limit; a visited map makes cycles harmless. Returns asset -> hops."""
        hops = {start: 0}
        frontier = [start]
        d = 1
        while d <= max_depth and frontier:
            nxt = []
            for u in frontier:
                for v in mapping.get(u, []):
                    if v not in hops:
                        hops[v] = d
                        nxt.append(v)
            frontier = nxt
            d += 1
        del hops[start]
        return hops

    def search(self, query):
        names = {}
        for a, b in self.edges:
            names[a] = True
            names[b] = True

        def score(n):
            return (1000 if n == query else 0) + 10 * len(self.down.get(n, []))

        found = [n for n in names if query in n]
        return sorted(found, key=lambda n: (-score(n), n))


seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


catalog = Catalog()
accepted = 0
for k in range(300):
    out = 20 + random(180)  # asset names t20..t199; inputs always have a lower number, so the graph is acyclic
    picks = [random(out), random(out)]
    inputs = [f"t{i}" for i in dict.fromkeys(picks)]
    ev = {"id": f"e{k}", "inputs": inputs, "outputs": [f"t{out}"]}
    for _ in range(2):  # every event arrives twice
        if catalog.ingest(ev):
            accepted += 1
print(f"events accepted: {accepted} of 600 deliveries, edges: {len(catalog.edges)}")


def hops(limit):
    return catalog.reach(catalog.down, "t0", limit)


print(f"t0 impact: {len(hops(1))} at 1 hop, {len(hops(2))} within 2 hops, {len(hops(99))} in all")
print(f"t0 is {max(hops(99).values())} hops from its farthest consumer, and {len(catalog.reach(catalog.up, 't199', 99))} assets feed t199")

teams = sorted({f"team-{int(n[1:]) % 5}" for n in hops(99)})
print(f"teams to notify: {', '.join(teams)}")
print(f"search \"t1\": {', '.join(catalog.search('t1')[:3])}")

# Check against the slow, obvious method: keep relaxing every edge until nothing changes.
slow = {"t0"}
changed = True
while changed:
    changed = False
    for a, b in catalog.edges:
        if a in slow and b not in slow:
            slow.add(b)
            changed = True
slow.discard("t0")
same = len(slow) == len(hops(99)) and all(n in hops(99) for n in slow)
catalog.ingest({"id": "cycle", "inputs": ["t150"], "outputs": ["t0"]})  # a feedback loop must not hang the walk
survives = len(hops(99)) == len(slow)
print(f"matches the slow method: {str(same).lower()}; survives a cycle: {str(survives).lower()}")
if not same or not survives or accepted != 300:
    sys.exit(1)
