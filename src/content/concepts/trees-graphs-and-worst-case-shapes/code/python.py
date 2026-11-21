# Trees and graphs: the cost depends on the SHAPE of the tree and on how the graph is stored, not only on n.
# Part 1: insert n keys into a plain binary search tree and into an AVL tree (a self-balancing tree), count comparisons and height.
# Part 2: breadth-first search, depth-first search and Dijkstra on a graph stored as an adjacency list or an adjacency matrix.
# Look for: sorted keys turn the plain tree into a chain (height n); the matrix needs V*V cells and V*V steps; a BFS with no
# visited set never ends on a graph with a cycle; Dijkstra with a heap needs far fewer steps than Dijkstra with a scan.
import math
import sys

sys.setrecursionlimit(10000)  # Python's default is 1000 frames; the depth-first search below recurses 1000 deep


# ---------- Part 1: trees ----------
def key_order(order, n):
    if order == "sorted":
        return list(range(1, n + 1))
    if order == "zigzag":
        keys, lo, hi = [], 1, n
        while lo <= hi:
            keys.append(lo)
            lo += 1
            if lo <= hi:
                keys.append(hi)
                hi -= 1
        return keys
    # a fixed pseudo-random permutation of 1..n (Fisher-Yates driven by an integer generator)
    keys = list(range(1, n + 1))
    x = 777
    for i in range(n - 1, 0, -1):
        x = (x * 1664525 + 1013904223) % 4294967296
        j = (x // 65536) % (i + 1)
        keys[i], keys[j] = keys[j], keys[i]
    return keys


# Plain binary search tree. One comparison per node visited on the way down. Iterative, so a chain cannot overflow the stack.
def plain_tree(keys):
    key, left, right = [], [], []
    comparisons, height = 0, 0
    for k in keys:
        if not key:
            key.append(k)
            left.append(-1)
            right.append(-1)
            height = 1
            continue
        at, depth = 0, 1
        while True:
            comparisons += 1
            side = left if k < key[at] else right
            if side[at] == -1:
                key.append(k)
                left.append(-1)
                right.append(-1)
                side[at] = len(key) - 1
                depth += 1
                break
            at = side[at]
            depth += 1
        height = max(height, depth)

    def lookup(k):
        at, c = 0, 0
        while at != -1:
            c += 1
            if k == key[at]:
                break
            at = left[at] if k < key[at] else right[at]
        return c

    return comparisons, height, lookup


# AVL tree: after every insert, a node whose two sides differ in height by more than 1 is rotated, so height stays below 1.45 * log2(n + 2).
class Node:
    def __init__(self, k):
        self.k, self.l, self.r, self.h = k, None, None, 1


def avl_tree(keys):
    comparisons = [0]

    def h(t):
        return t.h if t else 0

    def fix(t):
        t.h = 1 + max(h(t.l), h(t.r))

    def rot_r(t):
        l = t.l
        t.l = l.r
        l.r = t
        fix(t)
        fix(l)
        return l

    def rot_l(t):
        r = t.r
        t.r = r.l
        r.l = t
        fix(t)
        fix(r)
        return r

    def insert(t, k):
        if not t:
            return Node(k)
        comparisons[0] += 1
        if k < t.k:
            t.l = insert(t.l, k)
        else:
            t.r = insert(t.r, k)
        fix(t)
        bal = h(t.l) - h(t.r)
        if bal > 1:
            if h(t.l.l) < h(t.l.r):
                t.l = rot_l(t.l)
            return rot_r(t)
        if bal < -1:
            if h(t.r.r) < h(t.r.l):
                t.r = rot_r(t.r)
            return rot_l(t)
        return t

    root = None
    for k in keys:
        root = insert(root, k)

    def lookup(k):
        t, c = root, 0
        while t:
            c += 1
            if k == t.k:
                break
            t = t.l if k < t.k else t.r
        return c

    return comparisons[0], h(root), lookup


print("-- n keys inserted into a plain tree and an AVL tree, then n lookups (comparisons)")
for n in [10, 100, 1000]:
    for order in ["random", "sorted", "zigzag"]:
        keys = key_order(order, n)
        pc, ph, plook = plain_tree(keys)
        ac, ah, alook = avl_tree(keys)
        lp = sum(plook(k) for k in keys)
        la = sum(alook(k) for k in keys)
        print(f"n={n} {order}: plain height {ph}, build {pc}, lookups {lp}; AVL height {ah}, build {ac}, lookups {la}")
    print(f"n={n}: the smallest possible height is {math.ceil(math.log2(n + 1))}")


# ---------- Part 2: graphs ----------
# A circulant graph: vertex i is joined to i+1 and i+2 (wrapping round), so every vertex has 4 neighbours and there are 2V edges.
def neighbours(V, i):
    return [(i + 1) % V, (i + 2) % V, (i + V - 1) % V, (i + V - 2) % V]


def weight(i, j):  # symmetric, 1..9
    return 1 + (((i + j) * 7 + abs(i - j) * 3) % 9)


# Breadth-first search from vertex 0. A step is a vertex taken off the queue, or an edge (list) / cell (matrix) examined.
def bfs(V, use_matrix, use_visited, cap):
    matrix = None
    if use_matrix:
        matrix = []
        for i in range(V):
            row = [0] * V
            for j in neighbours(V, i):
                row[j] = 1
            matrix.append(row)
    visited = [0] * V
    queue = [0]
    if use_visited:
        visited[0] = 1
    head, steps, reached = 0, 0, 1
    while head < len(queue):
        if steps >= cap:
            return steps, False, reached
        v = queue[head]
        head += 1
        steps += 1
        if use_matrix:
            for j in range(V):
                steps += 1
                if matrix[v][j] and not visited[j]:
                    visited[j] = 1
                    reached += 1
                    queue.append(j)
        else:
            for j in neighbours(V, v):
                steps += 1
                if not use_visited:
                    queue.append(j)  # no visited set: every edge examined is queued again
                elif not visited[j]:
                    visited[j] = 1
                    reached += 1
                    queue.append(j)
    return steps, True, reached


# Recursive depth-first search on a path of V vertices (the worst shape): the recursion is V frames deep.
def dfs_depth(V):
    seen = [0] * V
    deepest = [0]

    def go(v, depth):
        seen[v] = 1
        deepest[0] = max(deepest[0], depth)
        for j in [v + 1]:
            if j < V and not seen[j]:
                go(j, depth + 1)

    go(0, 1)
    return deepest[0]


# Dijkstra with a binary heap (lazy deletion): counts heap comparisons, pops and edges relaxed.
def dijkstra_heap(V):
    dist = [math.inf] * V
    done = [0] * V
    heap = []
    steps = [0]

    def less(a, b):
        steps[0] += 1
        return a[0] < b[0]

    def push(e):
        heap.append(e)
        i = len(heap) - 1
        while i > 0:
            p = (i - 1) >> 1
            if less(heap[i], heap[p]):
                heap[i], heap[p] = heap[p], heap[i]
                i = p
            else:
                break

    def pop():
        top, last = heap[0], heap.pop()
        if heap:
            heap[0] = last
            i = 0
            while True:
                l = 2 * i + 1
                r = l + 1
                s = i
                if l < len(heap) and less(heap[l], heap[s]):
                    s = l
                if r < len(heap) and less(heap[r], heap[s]):
                    s = r
                if s == i:
                    break
                heap[i], heap[s] = heap[s], heap[i]
                i = s
        return top

    dist[0] = 0
    push((0, 0))
    while heap:
        d, v = pop()
        steps[0] += 1
        if done[v]:
            continue
        done[v] = 1
        for j in neighbours(V, v):
            steps[0] += 1
            if d + weight(v, j) < dist[j]:
                dist[j] = d + weight(v, j)
                push((dist[j], j))
    return steps[0], sum(dist)


# Dijkstra with a scan: every round looks at all V vertices to find the nearest unfinished one.
def dijkstra_scan(V):
    dist = [math.inf] * V
    done = [0] * V
    steps = 0
    dist[0] = 0
    for _ in range(V):
        v = -1
        for i in range(V):
            steps += 1
            if not done[i] and (v == -1 or dist[i] < dist[v]):
                v = i
        done[v] = 1
        for j in neighbours(V, v):
            steps += 1
            if dist[v] + weight(v, j) < dist[j]:
                dist[j] = dist[v] + weight(v, j)
    return steps, sum(dist)


# The step formulas used by the simulation (E counts each undirected edge once, so there are 2E arcs).
def bfs_list(V, E): return V + 2 * E
def bfs_matrix(V): return V + V * V
def dijkstra_heap_formula(V, E): return (V + 2 * E) * math.ceil(math.log2(V))
def dijkstra_scan_formula(V, E): return V * V + 2 * E
# On a matrix, finding the neighbours of a vertex scans a whole row: V cells for each of V vertices.
def dijkstra_heap_matrix(V, E): return V * V + (V + 2 * E) * math.ceil(math.log2(V))
def dijkstra_scan_matrix(V): return 2 * V * V
def list_cells(V, E): return V + 2 * E
def matrix_cells(V): return V * V


print("-- breadth-first search from vertex 0, 4 neighbours per vertex (E = 2V)")
for V in [10, 100, 1000]:
    E = 2 * V
    ls, _, lr = bfs(V, False, True, 10**9)
    ms, _, _ = bfs(V, True, True, 10**9)
    print(f"V={V}: list {ls} steps (formula {bfs_list(V, E)}), matrix {ms} steps (formula {bfs_matrix(V)}), reached {lr}")
    print(f"V={V}: memory list {list_cells(V, E)} cells, matrix {matrix_cells(V)} cells")
print("-- the same search with no visited set, capped at 1000000 steps")
for V in [10, 100]:
    steps, finished, _ = bfs(V, False, False, 1000000)
    print(f"V={V}: {'finished' if finished else 'did not finish'} after {steps} steps")
print(f"-- recursive depth-first search on a path of 1000 vertices: {dfs_depth(1000)} frames deep")
print("-- Dijkstra from vertex 0: heap against scan (real steps, then the formula)")
for V in [10, 100, 1000]:
    E = 2 * V
    hs, hsum = dijkstra_heap(V)
    ss, ssum = dijkstra_scan(V)
    print(f"V={V}: heap {hs} (formula {dijkstra_heap_formula(V, E)}), scan {ss} (formula {dijkstra_scan_formula(V, E)}), same distances {'true' if hsum == ssum else 'false'}")
print("-- by the formulas at V = 100000 and E = 2V (sparse)")
V = 100000
E = 2 * V
print(f"list {list_cells(V, E)} cells, matrix {matrix_cells(V)} cells")
print(f"BFS: list {bfs_list(V, E)} steps, matrix {bfs_matrix(V)} steps")
print(f"Dijkstra: heap {dijkstra_heap_formula(V, E)} steps, scan {dijkstra_scan_formula(V, E)} steps")
print(f"Dijkstra on a matrix: heap {dijkstra_heap_matrix(V, E)} steps, scan {dijkstra_scan_matrix(V)} steps")
print(f"100 separate searches instead of one: {100 * bfs_list(V, E)} steps against {bfs_list(V, E)}")
