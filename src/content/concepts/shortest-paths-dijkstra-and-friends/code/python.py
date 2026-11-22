# Shortest paths, counted in steps: Dijkstra with a binary heap and with a plain array, Bellman-Ford, and A* on a grid.
# A step is one comparison inside the heap, one node looked at while scanning for the closest unsettled one, or one edge checked
# ("relaxed"). Nothing is timed.
# Look for: the heap wins on sparse graphs and can lose on dense ones; one negative edge makes Dijkstra return wrong distances
# without any error while Bellman-Ford stays right (and spots a negative cycle); a good A* heuristic expands a fraction of the
# nodes Dijkstra does, and one that overestimates saves even more but returns a longer path.
# Graphs come from fixed integer formulas. A heap entry is priority * KEY + node, so equal priorities are ordered by node.

INF = 10 ** 9
KEY = 100000
OFFSET = 1000000  # added to a distance inside a heap key, so a negative distance still gives a positive key
TIE = 4096  # A* priority is f * TIE - g: among equal f, the node with the larger g (closer to the goal) goes first


class Heap:
    def __init__(self):
        self.a = []
        self.c = 0  # comparisons inside the heap

    def push(self, key):
        a = self.a
        a.append(key)
        i = len(a) - 1
        while i > 0:
            p = (i - 1) // 2
            self.c += 1
            if key < a[p]:
                a[i] = a[p]
                i = p
            else:
                break
        a[i] = key

    def pop(self):
        a = self.a
        top, last = a[0], a.pop()
        if a:
            n, i = len(a), 0
            while True:
                s = 2 * i + 1
                if s >= n:
                    break
                if s + 1 < n:
                    self.c += 1
                    if a[s + 1] < a[s]:
                        s += 1
                self.c += 1
                if a[s] < last:
                    a[i] = a[s]
                    i = s
                else:
                    break
            a[i] = last
        return top


def make_graph(kind, v):
    adj = [[] for _ in range(v)]
    for i in range(v):
        if kind == "sparse":  # three edges per node, weights 1 to 20
            for k in range(3):
                t = (i * (2 * k + 3) * 7919 + k * 104729 + 13) % v
                if t == i:
                    t = (t + 1) % v
                adj[i].append((t, 1 + (i * 31 + k * 17 + t * 7) % 20))
        elif kind == "dense":  # each node points at half of the others
            for k in range(v // 2):
                t = (i + 1 + 2 * k + i % 2) % v
                if t != i:
                    adj[i].append((t, 1 + (i * 31 + t * 17) % 20))
        elif kind == "adversarial":  # every edge improves a distance when it is relaxed, so the heap gets a push for each
            for t in range(i + 1, v):
                adj[i].append((t, 1 if t == i + 1 else 3 * (v - i) + (t - i)))
        elif kind == "backward":  # a chain whose edges point against the order Bellman-Ford sweeps the nodes in: from the last node, one hop per round
            if i > 0:
                adj[i].append((i - 1, 1))
        else:  # "negative": a layered graph, edges only forward, weights -4 to 10: no cycles, so no negative cycle
            for t in range(i + 1, min(v, i + 4)):
                adj[i].append((t, (i * 37 + t * 11) % 15 - 4))
    return adj


def dijkstra_array(adj, src):
    v = len(adj)
    dist, done = [INF] * v, [False] * v
    dist[src] = 0
    steps = 0
    while True:
        best = -1
        for u in range(v):  # scan every node for the closest one not settled yet
            steps += 1
            if not done[u] and dist[u] < INF and (best < 0 or dist[u] < dist[best]):
                best = u
        if best < 0:
            break
        done[best] = True
        for t, w in adj[best]:
            steps += 1
            if dist[best] + w < dist[t]:
                dist[t] = dist[best] + w
    return dist, steps


def dijkstra_heap(adj, src):
    v = len(adj)
    dist, done = [INF] * v, [False] * v
    dist[src] = 0
    h, edges, pushes = Heap(), 0, 1
    h.push(OFFSET * KEY + src)
    while h.a:
        u = h.pop() % KEY
        if done[u]:
            continue  # a stale entry: the node was already settled with a smaller distance
        done[u] = True
        for t, w in adj[u]:
            edges += 1
            if dist[u] + w < dist[t]:
                dist[t] = dist[u] + w
                h.push((dist[t] + OFFSET) * KEY + t)
                pushes += 1
    return dist, h.c + edges, pushes


def bellman_ford(adj, src):
    v = len(adj)
    dist = [INF] * v
    dist[src] = 0
    relax, rounds = 0, 0
    for _ in range(v):
        changed = False
        rounds += 1
        for u in range(v):
            if dist[u] == INF:
                continue
            for t, w in adj[u]:
                relax += 1
                if dist[u] + w < dist[t]:
                    dist[t] = dist[u] + w
                    changed = True
        if not changed:
            return dist, relax, rounds, False
    return dist, relax, rounds, True  # still improving after v rounds: a negative cycle is reachable


print("-- Dijkstra from node 0: heap against array (steps)")
for kind in ["sparse", "dense", "adversarial"]:
    for v in [100, 1000]:
        adj = make_graph(kind, v)
        e = sum(len(x) for x in adj)
        da, sa = dijkstra_array(adj, 0)
        dh, sh, pushes = dijkstra_heap(adj, 0)
        if da != dh:
            raise Exception("the two implementations disagree")
        print(f"{kind} V={v} E={e}: array {sa}, heap {sh} ({pushes} pushes)")

print("-- negative edge weights: Dijkstra (settle each node once) against Bellman-Ford")
for v in [100, 1000]:
    adj = make_graph("negative", v)
    e = sum(len(x) for x in adj)
    bf, relax, rounds, cyc = bellman_ford(adj, 0)
    dj, steps, _ = dijkstra_heap(adj, 0)
    wrong = sum(1 for i in range(v) if bf[i] != dj[i])
    worst = max(dj[i] - bf[i] for i in range(v))
    print(f"V={v} E={e}: Bellman-Ford {relax} edge checks in {rounds} rounds; Dijkstra {steps} steps and wrong for {wrong} of {v} nodes (too long by up to {worst})")

# The smallest example: A -> B costs 3, A -> C costs 5, C -> B costs -4, B -> D costs 1. The best way to B is through C and costs 1.
triangle = [[(1, 3), (2, 5)], [(3, 1)], [(1, -4)], []]
dt, bt = dijkstra_heap(triangle, 0)[0], bellman_ford(triangle, 0)[0]
print(f"four nodes, A->B 3, A->C 5, C->B -4, B->D 1: Dijkstra says B costs {dt[1]} and D costs {dt[3]}; Bellman-Ford says B costs {bt[1]} and D costs {bt[3]}")

# 0 -> 1 costs 2, 1 -> 2 costs -3, 2 -> 1 costs 1: going round 1 -> 2 -> 1 costs -2 each time.
cycle = [[(1, 2)], [(2, -3)], [(1, 1)]]
_, relax, rounds, cyc = bellman_ford(cycle, 0)
print(f"negative cycle: Bellman-Ford still improving after {rounds} rounds ({relax} edge checks), so it reports a cycle: {str(cyc).lower()}")

print("-- Bellman-Ford against Dijkstra with a heap, all weights positive (steps)")
for v in [100, 1000]:
    adj = make_graph("sparse", v)
    _, relax, rounds, _ = bellman_ford(adj, 0)
    _, sh, _ = dijkstra_heap(adj, 0)
    print(f"sparse V={v}: Bellman-Ford {relax} edge checks in {rounds} rounds, Dijkstra {sh}")
for v in [100, 1000]:
    adj = make_graph("backward", v)
    _, relax, rounds, _ = bellman_ford(adj, v - 1)
    _, sh, _ = dijkstra_heap(adj, v - 1)
    print(f"backward chain V={v}: Bellman-Ford {relax} edge checks in {rounds} rounds, Dijkstra {sh}")


def grid_cost(w, x, y):  # a few blocked cells (cost None), start and goal always open
    if (x == 0 and y == 0) or (x == w - 1 and y == w - 1):
        return 1
    return None if (x * 31 + y * 17) % 11 == 0 else 1


def a_star(w, factor):
    # Moves cost 1. The heuristic is factor * (Manhattan distance to the goal): 0 is plain Dijkstra, 1 never overestimates, 3 does.
    n = w * w
    goal = n - 1
    g, closed = [INF] * n, [False] * n
    g[0] = 0
    h, expanded, edges = Heap(), 0, 0
    h.push((factor * (2 * (w - 1)) * TIE - 0) * KEY + 0)
    while h.a:
        u = h.pop() % KEY
        if closed[u]:
            continue
        closed[u] = True
        expanded += 1
        if u == goal:
            return expanded, edges, g[u]
        x, y = u % w, u // w
        for nx, ny in ((x + 1, y), (x, y + 1), (x - 1, y), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < w and grid_cost(w, nx, ny) is not None:
                edges += 1
                t = ny * w + nx
                if g[u] + 1 < g[t]:
                    g[t] = g[u] + 1
                    h.push(((g[t] + factor * ((w - 1 - nx) + (w - 1 - ny))) * TIE - g[t]) * KEY + t)
    return expanded, edges, -1


print("-- A* on a grid with some blocked cells: nodes expanded before reaching the far corner")
for w in [20, 50, 100]:
    row = []
    for name, factor in [("no heuristic (Dijkstra)", 0), ("Manhattan distance", 1), ("3 x Manhattan distance", 3)]:
        expanded, edges, cost = a_star(w, factor)
        row.append(f"{name}: {expanded} expanded, path cost {cost}")
    print(f"{w}x{w} grid ({w * w} cells): " + "; ".join(row))
