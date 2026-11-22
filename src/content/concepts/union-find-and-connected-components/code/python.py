# Union-find (disjoint sets) with and without path compression and union by rank, counting operations, not time.
# One operation = one read or write of a parent pointer (following a pointer, linking two roots, or rewriting a pointer during compression).
# Look for: the chain workload makes plain union-find quadratic (every query walks the whole chain) while
# compression or rank (or both) keep it near one step per operation; random edges are kind to everything;
# a graph traversal wins when the graph is fixed (one pass labels every component) but must be re-run after
# every new edge when edges keep arriving, which is where union-find earns its place.

M = 2147483647  # Park-Miller generator: small enough that a * 48271 fits in 53 bits, so all languages agree


class Rng:
    def __init__(self, seed):
        self.s = seed

    def next(self):
        self.s = self.s * 48271 % M
        return self.s


class DSU:
    def __init__(self, n, rank, compress):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.use_rank, self.use_compress = rank, compress
        self.ops = 0

    def find(self, x):
        r = x
        while self.parent[r] != r:
            r = self.parent[r]
            self.ops += 1
        if self.use_compress:
            while self.parent[x] != r:  # second pass: point every node on the path straight at the root
                nxt = self.parent[x]
                self.parent[x] = r
                self.ops += 1
                x = nxt
        return r

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.use_rank and self.rank[ra] > self.rank[rb]:
            ra, rb = rb, ra  # attach the shallower root under the deeper one
        self.parent[ra] = rb
        self.ops += 1
        if self.use_rank and self.rank[ra] == self.rank[rb]:
            self.rank[rb] += 1
        return True

    def depth(self):
        best = 0
        for x in range(len(self.parent)):
            d = 0
            while self.parent[x] != x:
                x = self.parent[x]
                d += 1
            best = max(best, d)
        return best


VARIANTS = [("naive", False, False), ("rank", True, False), ("compression", False, True), ("both", True, True)]


def random_workload(n, seed=12345):
    rng = Rng(seed)
    edges = [(rng.next() % n, rng.next() % n) for _ in range(n)]
    queries = [(rng.next() % n, rng.next() % n) for _ in range(n)]
    return edges, queries


# Traversal on a fixed graph: build adjacency, then one pass labels every component; each query is a label comparison.
def traversal_static(n, edges, queries):
    ops = 0
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
        ops += 1
    label = [-1] * n
    comps = 0
    for s in range(n):
        ops += 1
        if label[s] >= 0:
            continue
        label[s] = comps
        stack = [s]
        while stack:
            x = stack.pop()
            for y in adj[x]:
                ops += 1
                if label[y] < 0:
                    label[y] = comps
                    stack.append(y)
        comps += 1
    answers = 0
    for a, b in queries:
        ops += 1
        if label[a] == label[b]:
            answers += 1
    return ops, comps, answers


def run_random(n):
    edges, queries = random_workload(n)
    out = {}
    for name, rank, comp in VARIANTS:
        d = DSU(n, rank, comp)
        for a, b in edges:
            d.union(a, b)
        built_depth = d.depth()
        answers = sum(1 for a, b in queries if d.find(a) == d.find(b))
        comps = sum(1 for x in range(n) if d.parent[x] == x)
        out[name] = (d.ops, comps, answers, built_depth)
    return out, traversal_static(n, edges, queries)


# Chain workload: edge i joins element i and i+1; after every edge ask "is element 0 connected to the newest element?".
def run_chain(n):
    out = {}
    for name, rank, comp in VARIANTS:
        d = DSU(n, rank, comp)
        yes = 0
        for i in range(n - 1):
            d.union(i, i + 1)
            if d.find(0) == d.find(i + 1):
                yes += 1
        out[name] = (d.ops, yes)
    # Traversal has no way to add an edge to an answer already computed: after each edge it searches again from element 0.
    ops, yes = 0, 0
    adj = [[] for _ in range(n)]
    for i in range(n - 1):
        adj[i].append(i + 1)
        adj[i + 1].append(i)
        ops += 1
        seen = [False] * n
        seen[0] = True
        stack, found = [0], False
        while stack and not found:
            x = stack.pop()
            ops += 1
            if x == i + 1:
                found = True
                break
            for y in adj[x]:
                ops += 1
                if not seen[y]:
                    seen[y] = True
                    stack.append(y)
        if found:
            yes += 1
    out["traversal"] = (ops, yes)
    return out


print("-- random edges: n edges, then n connectivity queries (pointer operations)")
for n in [10, 100, 1000]:
    dsu, trav = run_random(n)
    print(f"  n={n}: naive {dsu['naive'][0]}, rank {dsu['rank'][0]}, compression {dsu['compression'][0]}, both {dsu['both'][0]}, "
          f"one traversal pass {trav[0]}; components {dsu['both'][1]} (traversal {trav[1]}), connected answers {dsu['both'][2]} (traversal {trav[2]})")
print("-- deepest path from any element to its root after the random edges (before any query compresses it)")
for n in [10, 100, 1000]:
    dsu, _ = run_random(n)
    print(f"  n={n}: naive {dsu['naive'][3]}, rank {dsu['rank'][3]}")
print("-- chain: edge i joins i and i+1, then ask whether 0 is connected to the newest element, after every edge")
for n in [10, 100, 1000]:
    r = run_chain(n)
    print(f"  n={n}: naive {r['naive'][0]}, rank {r['rank'][0]}, compression {r['compression'][0]}, both {r['both'][0]}, "
          f"traversal re-run after every edge {r['traversal'][0]}; every answer yes: {all(v[1] == n - 1 for v in r.values())}")
