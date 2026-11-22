# Topological sort on a build-dependency graph, counting operations (node visits + edge visits), not time.
# Three ways to order tasks so every task comes after the tasks it depends on:
#   scan  : the "obvious" loop, rescans every task each time it needs the next ready one
#   kahn  : count unfinished dependencies per task, release a task when its count reaches 0
#   dfs   : depth-first, emit a task after all of its dependencies
# Look for: scan grows with the square of n, Kahn and DFS with n + edges; a cycle is detected, never ordered;
# tasks downstream of a cycle are stuck too, so the "stuck" count is larger than the cycle itself;
# the number of levels (the critical path) limits how much extra workers can help.
import sys

sys.setrecursionlimit(10000)


# Task labels are scrambled so that ids do not already come in dependency order.
def label(i, n):
    return (i * 37 + 11) % n


def build(n, with_cycle):
    deps = [[] for _ in range(n)]
    for i in range(n):
        d = []
        if i % 4 != 0:
            d.append(label(i - 1, n))
        for j in range(max(0, i - 8), i - 1):
            if (i * 7 + j * 13) % 9 == 0:
                d.append(label(j, n))
        deps[label(i, n)] = d
    if with_cycle:
        a = 4 * (n // 8) + 1  # a depends on a+2, which depends on a+1, which depends on a: a 3-task cycle
        deps[label(a, n)].append(label(a + 2, n))
    return deps


def count_edges(deps):
    return sum(len(d) for d in deps)


# 1. Scan: restart from the first task every time, pick the first unfinished task whose dependencies are all done.
def scan_sort(deps):
    n, ops = len(deps), 0
    done, order = [False] * n, []
    while len(order) < n:
        picked = -1
        for t in range(n):
            ops += 1
            if done[t]:
                continue
            ready = True
            for d in deps[t]:
                ops += 1
                if not done[d]:
                    ready = False
                    break
            if ready:
                picked = t
                break
        if picked < 0:
            break  # nothing is ready: a cycle (without this guard the loop would never end)
        done[picked] = True
        order.append(picked)
    return order, ops


# 2. Kahn: indegree = number of unfinished dependencies; a queue holds the ready tasks.
def kahn_sort(deps):
    n, ops = len(deps), 0
    dependents = [[] for _ in range(n)]
    indeg = [0] * n
    for t in range(n):
        for d in deps[t]:
            ops += 1
            dependents[d].append(t)
            indeg[t] += 1
    queue = []
    for t in range(n):
        ops += 1
        if indeg[t] == 0:
            queue.append(t)
    head, order = 0, []
    while head < len(queue):
        t = queue[head]
        head += 1
        ops += 1
        order.append(t)
        for u in dependents[t]:
            ops += 1
            indeg[u] -= 1
            if indeg[u] == 0:
                queue.append(u)
    return order, ops


# 3. DFS with three colours: 0 = not seen, 1 = on the current path, 2 = finished. Meeting a 1 means a cycle.
def dfs_sort(deps):
    n = len(deps)
    colour, order = [0] * n, []
    state = {"ops": 0, "cycle_at": -1}

    def visit(t):
        state["ops"] += 1
        colour[t] = 1
        for d in deps[t]:
            state["ops"] += 1
            if colour[d] == 1:
                if state["cycle_at"] < 0:
                    state["cycle_at"] = d
            elif colour[d] == 0:
                visit(d)
        colour[t] = 2
        order.append(t)

    for t in range(n):
        state["ops"] += 1
        if colour[t] == 0:
            visit(t)
    return order, state["ops"], state["cycle_at"]


def valid(order, deps):
    pos = {t: i for i, t in enumerate(order)}
    return all(pos[d] < pos[t] for t in order for d in deps[t])


# Levels: level 1 = no dependencies, otherwise 1 + the highest level among dependencies (the critical path length).
def levels(deps):
    order, _ = kahn_sort(deps)
    lv = [0] * len(deps)
    for t in order:
        lv[t] = 1 + max([lv[d] for d in deps[t]], default=0)
    return max(lv)


# Makespan with w workers, every task takes 1 time unit: each step runs up to w ready tasks (lowest id first).
def makespan(deps, w):
    n = len(deps)
    dependents = [[] for _ in range(n)]
    indeg = [len(d) for d in deps]
    for t in range(n):
        for d in deps[t]:
            dependents[d].append(t)
    ready = sorted(t for t in range(n) if indeg[t] == 0)
    steps, finished = 0, 0
    while finished < n:
        batch, ready = ready[:w], ready[w:]
        steps += 1
        finished += len(batch)
        for t in batch:
            for u in dependents[t]:
                indeg[u] -= 1
                if indeg[u] == 0:
                    ready.append(u)
        ready.sort()
    return steps


print("-- operations to order a build, n tasks (no cycle)")
for n in [10, 100, 1000]:
    deps = build(n, False)
    s_order, s_ops = scan_sort(deps)
    k_order, k_ops = kahn_sort(deps)
    d_order, d_ops, d_cycle = dfs_sort(deps)
    ok = valid(s_order, deps) and valid(k_order, deps) and valid(d_order, deps) and len(s_order) == n
    print(f"  n={n}: edges {count_edges(deps)}, scan {s_ops}, kahn {k_ops}, dfs {d_ops}, all valid orders: {ok}")

print("-- the same build with one 3-task cycle added")
for n in [10, 100, 1000]:
    deps = build(n, True)
    s_order, s_ops = scan_sort(deps)
    k_order, k_ops = kahn_sort(deps)
    d_order, d_ops, d_cycle = dfs_sort(deps)
    print(f"  n={n}: scan ordered {len(s_order)} of {n} in {s_ops} ops, kahn ordered {len(k_order)} of {n} in {k_ops} ops, "
          f"dfs found a cycle: {d_cycle >= 0} in {d_ops} ops, tasks stuck behind the cycle: {n - len(k_order)}")

print("-- levels and parallel build time (1 unit per task)")
for n in [10, 100, 1000]:
    deps = build(n, False)
    print(f"  n={n}: levels {levels(deps)}, 1 worker {makespan(deps, 1)}, 4 workers {makespan(deps, 4)}, 16 workers {makespan(deps, 16)}, unlimited workers {makespan(deps, n)}")
