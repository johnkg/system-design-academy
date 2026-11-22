# Breadth-first and depth-first search on five graph shapes, counting edge checks, the widest the waiting list gets
# (queue for BFS, stack for DFS) and how deep a recursive DFS would go. No wall-clock time anywhere.
# Look for: BFS and DFS touch the same nodes and edges, but their memory differs by shape (BFS is widest on a star or a tree,
# DFS is deepest on a chain or a grid); only BFS finds the fewest-hops path; without a visited set the work explodes or never ends.
# DFS is "recursive" in order but runs on an explicit stack here, so the program never hits a recursion limit: it reports the
# depth a real recursive version would need.
# Graphs are built from fixed integer formulas. Neighbours are listed in the order the edges were added.

CAP = 100000  # the no-visited-set runs stop after this many steps, so the program still ends


def build(shape, n):
    if shape == "grid":  # w x w squares: the largest w with w * w <= n
        w = 0
        while (w + 1) * (w + 1) <= n:
            w += 1
        n = w * w
    adj = [[] for _ in range(n)]

    def edge(a, b):
        if a != b and b not in adj[a]:
            adj[a].append(b)
            adj[b].append(a)

    if shape == "chain":
        for v in range(n - 1):
            edge(v, v + 1)
    elif shape == "tree":  # a complete binary tree, root 0
        for v in range(1, n):
            edge((v - 1) // 2, v)
    elif shape == "star":  # node 0 is a hub
        for v in range(1, n):
            edge(0, v)
    elif shape == "grid":  # right and down edges added first
        for v in range(n):
            if v % w < w - 1:
                edge(v, v + 1)
            if v // w < w - 1:
                edge(v, v + w)
    else:  # random-looking: a ring plus one pseudo-random chord per node
        for v in range(n):
            edge(v, (v + 1) % n)
            edge(v, (v * 7919 + 13) % n)
    return adj


def bfs(adj, start, target):
    # Returns (nodes taken off the queue, edge checks, widest the queue got, hops to target or -1). Stops when the target is dequeued.
    seen = [False] * len(adj)
    dist = [0] * len(adj)
    queue, head, seen[start] = [start], 0, True
    nodes = edges = widest = 0
    while head < len(queue):
        v = queue[head]
        head += 1
        nodes += 1
        if v == target:
            return nodes, edges, widest, dist[v]
        for w in adj[v]:
            edges += 1
            if not seen[w]:
                seen[w] = True
                dist[w] = dist[v] + 1
                queue.append(w)
        widest = max(widest, len(queue) - head)
    return nodes, edges, widest, -1


def dfs(adj, start, target):
    # Recursive DFS on an explicit stack of (node, next neighbour index). Returns (nodes entered, edge checks, deepest recursion in
    # frames, length of the path to the target when it was entered or -1). Stops at the target.
    seen = [False] * len(adj)
    stack, seen[start] = [[start, 0]], True
    nodes, edges, deepest = 1, 0, 1
    if start == target:
        return nodes, edges, deepest, 0
    while stack:
        top = stack[-1]
        v = top[0]
        if top[1] == len(adj[v]):
            stack.pop()
            continue
        w = adj[v][top[1]]
        top[1] += 1
        edges += 1
        if not seen[w]:
            seen[w] = True
            nodes += 1
            stack.append([w, 0])
            deepest = max(deepest, len(stack))
            if w == target:
                return nodes, edges, deepest, len(stack) - 1
    return nodes, edges, deepest, -1


def dfs_push_all(adj, start):
    # The other common DFS: pop a node, skip it if seen, mark it, push all its neighbours. The stack can hold a node many times.
    seen = [False] * len(adj)
    stack, widest = [start], 1
    while stack:
        v = stack.pop()
        if seen[v]:
            continue
        seen[v] = True
        for w in adj[v]:
            if not seen[w]:
                stack.append(w)
        widest = max(widest, len(stack))
    return widest


print("-- full traversal from node 0: edge checks, widest waiting list, deepest recursion")
for shape in ["chain", "tree", "star", "grid", "random"]:
    for n in [100, 10000]:
        adj = build(shape, n)
        nodes, edges, queue, _ = bfs(adj, 0, -1)
        dn, de, depth, _ = dfs(adj, 0, -1)
        print(f"{shape} n={len(adj)}: BFS visits {nodes}, {edges} edge checks, queue peaks at {queue}; DFS visits {dn}, {de} edge checks, recursion depth {depth}, push-all stack peaks at {dfs_push_all(adj, 0)}")

print("-- the way to the far node (the last one; for random, the one halfway round): BFS against DFS")
for shape in ["tree", "grid", "random"]:
    for n in [100, 10000]:
        adj = build(shape, n)
        target = len(adj) // 2 if shape == "random" else len(adj) - 1  # random: halfway round the ring
        bn, _, _, hops = bfs(adj, 0, target)
        dn, _, _, length = dfs(adj, 0, target)
        print(f"{shape} n={len(adj)}: BFS path {hops} edges after visiting {bn} nodes; DFS path {length} edges after visiting {dn} nodes")


def walk_without_visited(adj, start):
    # Depth-first with no visited set, stopping at a step cap. Returns (steps, gave_up).
    steps, stack = 0, [[start, 0]]
    while stack:
        steps += 1
        if steps >= CAP:
            return steps, True
        top = stack[-1]
        v = top[0]
        if top[1] == len(adj[v]):
            stack.pop()
            continue
        w = adj[v][top[1]]
        top[1] += 1
        stack.append([w, 0])
    return steps, False


print("-- without a visited set")
for shape in ["chain", "tree", "grid"]:
    adj = build(shape, 100)
    steps, gave_up = walk_without_visited(adj, 0)
    print(f"{shape} n={len(adj)}: " + (f"gave up at {steps} steps, still going" if gave_up else f"finished in {steps} steps"))


def diamond_walk(levels, use_visited):
    # Directed chain of diamonds: both nodes of level l point to both nodes of level l + 1. Counts node entries from level 0.
    entries, seen, stack = 0, set(), [(0, 0)]  # (level, side)
    while stack:
        level, side = stack.pop()
        if use_visited:
            if (level, side) in seen:
                continue
            seen.add((level, side))
        entries += 1
        if level < levels:
            stack.append((level + 1, 0))
            stack.append((level + 1, 1))
    return entries


for levels in [5, 10, 15, 20]:
    print(f"diamond chain, {levels} levels ({2 * levels + 1} nodes): without visited set {diamond_walk(levels, False)} node entries, with one {diamond_walk(levels, True)}")
