# Backtracking with and without pruning, counted in search nodes visited (one node = one call of the recursive search).
# Two classic problems:
#   N-queens: place n queens on an n x n board so that none attacks another (rows, columns, diagonals)
#   subset sum: count the subsets of a list of positive integers that add up to a target
# Look for: the same answers from every variant, but node counts that differ by factors of thousands;
# an ordering heuristic that changes how soon the FIRST answer is found but not the work to find ALL of them;
# and an input on which pruning helps much less, because backtracking is still exponential in the worst case.
import sys

sys.setrecursionlimit(10000)

M = 2147483647  # Park-Miller generator, so every language produces the same numbers


class Rng:
    def __init__(self, seed):
        self.s = seed

    def next(self):
        self.s = self.s * 48271 % M
        return self.s


# ---- N-queens ----

def queens_generate_and_test(n):
    """No pruning: choose a column for every row (n to the power n boards), look at the board only when it is full."""
    cols = [0] * n
    state = {"nodes": 0, "solutions": 0}

    def ok():
        for r in range(n):
            for s in range(r + 1, n):
                if cols[r] == cols[s] or abs(cols[r] - cols[s]) == s - r:
                    return False
        return True

    def place(row):
        state["nodes"] += 1
        if row == n:
            if ok():
                state["solutions"] += 1
            return
        for c in range(n):
            cols[row] = c
            place(row + 1)

    place(0)
    return state["solutions"], state["nodes"]


def queens_permutations(n):
    """Weak pruning: never reuse a column (n! boards), but still look at the diagonals only when the board is full."""
    cols = [0] * n
    used = [False] * n
    state = {"nodes": 0, "solutions": 0}

    def ok():
        for r in range(n):
            for s in range(r + 1, n):
                if abs(cols[r] - cols[s]) == s - r:
                    return False
        return True

    def place(row):
        state["nodes"] += 1
        if row == n:
            if ok():
                state["solutions"] += 1
            return
        for c in range(n):
            if not used[c]:
                used[c] = True
                cols[row] = c
                place(row + 1)
                used[c] = False

    place(0)
    return state["solutions"], state["nodes"]


def column_order(n, middle_first):
    cols = list(range(n))
    if middle_first:
        cols.sort(key=lambda c: (abs(2 * c - (n - 1)), c))
    return cols


def queens_pruned(n, middle_first=False, first_only=False):
    """Full pruning: a square attacked by an earlier queen is never tried, so the search never goes below a dead end."""
    order = column_order(n, middle_first)
    col_used = [False] * n
    diag1 = [False] * (2 * n)  # row + col
    diag2 = [False] * (2 * n)  # row - col + n
    state = {"nodes": 0, "solutions": 0}

    def place(row):
        state["nodes"] += 1
        if row == n:
            state["solutions"] += 1
            return first_only
        for c in order:
            if col_used[c] or diag1[row + c] or diag2[row - c + n]:
                continue
            col_used[c] = diag1[row + c] = diag2[row - c + n] = True
            stop = place(row + 1)
            col_used[c] = diag1[row + c] = diag2[row - c + n] = False
            if stop:
                return True
        return False

    place(0)
    return state["solutions"], state["nodes"]


def power_sum(n):
    """Nodes of a full tree with n levels and n children per node: n^0 + n^1 + ... + n^n."""
    return sum(n ** k for k in range(n + 1))


print("-- N-queens: search nodes visited to find ALL solutions")
for n in [4, 5, 6]:
    s1, n1 = queens_generate_and_test(n)
    s2, n2 = queens_permutations(n)
    s3, n3 = queens_pruned(n)
    print(f"  n={n}: {s3} solutions; every board {n1} nodes, no repeated column {n2} nodes, pruned {n3} nodes; all agree: {s1 == s2 == s3}")
for n in [7, 8]:
    s2, n2 = queens_permutations(n)
    s3, n3 = queens_pruned(n)
    print(f"  n={n}: {s3} solutions; every board {power_sum(n)} nodes (counted by formula), no repeated column {n2} nodes, pruned {n3} nodes; agree: {s2 == s3}")
for n in [9, 10, 11]:
    s3, n3 = queens_pruned(n)
    print(f"  n={n}: {s3} solutions; every board {power_sum(n)} nodes (formula), pruned {n3} nodes")

print("-- N-queens: nodes visited to find only the FIRST solution, by column order")
for n in [8, 12, 16, 20, 24]:
    a = queens_pruned(n, False, True)
    b = queens_pruned(n, True, True)
    print(f"  n={n}: left to right {a[1]} nodes, middle first {b[1]} nodes")


# ---- Subset sum ----

def make_items(n):
    rng = Rng(4242)
    return [1 + rng.next() % 50 for _ in range(n)]


def subset_plain(items, target):
    """No pruning: every item is either in or out (2 to the power n leaves)."""
    state = {"nodes": 0, "count": 0}

    def go(i, total):
        state["nodes"] += 1
        if i == len(items):
            if total == target:
                state["count"] += 1
            return
        go(i + 1, total)
        go(i + 1, total + items[i])

    go(0, 0)
    return state["count"], state["nodes"]


def subset_pruned(items, target, descending):
    """Prune when the running total passes the target, or when even taking every remaining item cannot reach it."""
    seq = sorted(items, reverse=True) if descending else list(items)
    suffix = [0] * (len(seq) + 1)
    for i in range(len(seq) - 1, -1, -1):
        suffix[i] = suffix[i + 1] + seq[i]
    state = {"nodes": 0, "count": 0}

    def go(i, total):
        state["nodes"] += 1
        if total > target or total + suffix[i] < target:
            return
        if i == len(seq):
            state["count"] += 1
            return
        go(i + 1, total + seq[i])
        go(i + 1, total)

    go(0, 0)
    return state["count"], state["nodes"]


print("-- N-queens: nodes to find ALL solutions, whatever the column order (the order only moves WHERE the solutions are)")
for n in [8, 10]:
    print(f"  n={n}: left to right {queens_pruned(n)[1]} nodes, middle first {queens_pruned(n, True)[1]} nodes")

print("-- subset sum: how many subsets add up to half of the total (nodes visited)")
for n in [10, 16, 20]:
    items = make_items(n)
    target = sum(items) // 2
    c0, n0 = subset_plain(items, target)
    c1, n1 = subset_pruned(items, target, False)
    c2, n2 = subset_pruned(items, target, True)
    print(f"  n={n}: target {target}, {c0} subsets; no pruning {n0} nodes, pruned in given order {n1}, pruned largest first {n2}; all agree: {c0 == c1 == c2}")
print("-- subset sum with pruning only (no pruning would visit 2^(n+1) - 1 nodes)")
for n in [24]:
    items = make_items(n)
    target = sum(items) // 2
    c2, n2 = subset_pruned(items, target, True)
    print(f"  n={n}: {c2} subsets, pruned largest first {n2} nodes, against {2 ** (n + 1) - 1} without pruning")
print("-- a bad case for pruning: n items all equal to 2 and an odd target of n + 1 (no subset works)")
for n in [16, 20]:
    items = [2] * n
    target = n + 1 if n % 2 == 0 else n
    c, nodes = subset_pruned(items, target, True)
    print(f"  n={n}: {c} subsets, {nodes} nodes pruned, against {2 ** (n + 1) - 1} without pruning")
