# Divide and conquer: merge sort counted in comparisons and element copies, the cost of splitting unevenly,
# the master-theorem recurrence T(n) = a T(n/b) + f(n) evaluated level by level, and work against span (parallel potential).
# Nothing is timed. Look for:
#   - merge sort costs about n log2 n operations, insertion sort (no divide) about n squared / 4 comparisons plus as many moves
#   - a split at a fixed fraction (25%, 10%) is still n log n with a larger constant; peeling off ONE element is quadratic
#   - which level of the recursion tree dominates decides the total: leaves, every level equally, or the root
#   - the sequential merge at the top of the tree limits parallel speed-up (span), long before processors run out
import sys

sys.setrecursionlimit(20000)

M = 2147483647  # Park-Miller generator, so every language produces the same numbers


class Rng:
    def __init__(self, seed):
        self.s = seed

    def next(self):
        self.s = self.s * 48271 % M
        return self.s


def make_data(n):
    rng = Rng(31337)
    return [rng.next() % 100000 for _ in range(n)]


def ceil_log2(n):
    k = 0
    while (1 << k) < n:
        k += 1
    return k


# Merge sort that splits at pct percent of the list (pct 0 means: peel off exactly one element).
# Counts: comparisons while merging, copies (every element is written once per merge), deepest recursion.
def merge_sort(a, pct):
    stats = {"cmp": 0, "copy": 0, "depth": 0}

    def sort(xs, depth):
        stats["depth"] = max(stats["depth"], depth)
        n = len(xs)
        if n <= 1:
            return xs
        left_n = 1 if pct == 0 else max(1, min(n - 1, n * pct // 100))
        left, right = sort(xs[:left_n], depth + 1), sort(xs[left_n:], depth + 1)
        out, i, j = [], 0, 0
        while i < len(left) and j < len(right):
            stats["cmp"] += 1
            if left[i] <= right[j]:
                out.append(left[i])
                i += 1
            else:
                out.append(right[j])
                j += 1
        out.extend(left[i:])
        out.extend(right[j:])
        stats["copy"] += n
        return out

    result = sort(list(a), 1)
    return result, stats


def insertion_sort(a):
    xs = list(a)
    cmp = moves = 0
    for i in range(1, len(xs)):
        v, j = xs[i], i - 1
        while j >= 0:
            cmp += 1
            if xs[j] > v:
                xs[j + 1] = xs[j]
                moves += 1
                j -= 1
            else:
                break
        xs[j + 1] = v
    return xs, cmp, moves


print("-- merge sort (split in half): comparisons + copies against n * ceil(log2 n)")
for n in [10, 100, 1000, 10000, 100000]:
    data = make_data(n)
    out, st = merge_sort(data, 50)
    assert out == sorted(data)
    print(f"  n={n}: {st['cmp']} comparisons + {st['copy']} copies = {st['cmp'] + st['copy']}, n*ceil(log2 n) = {n * ceil_log2(n)}, depth {st['depth']}")
print("-- no divide: insertion sort on the same data (comparisons + moves)")
for n in [10, 100, 1000]:
    out, c, m = insertion_sort(make_data(n))
    print(f"  n={n}: {c} comparisons + {m} moves = {c + m}")

print("-- merge sort with an uneven split: total operations (comparisons + copies) and recursion depth")
for n in [100, 1000, 2000]:
    row = []
    for label, pct in [("50%", 50), ("25%", 25), ("10%", 10), ("one element", 0)]:
        out, st = merge_sort(make_data(n), pct)
        row.append(f"{label}: {st['cmp'] + st['copy']} ops, depth {st['depth']}")
    print(f"  n={n}: " + "; ".join(row))


# ---- Recurrence T(n) = a T(n/b) + f(n), with T(1) = 1, for n = b^k, evaluated level by level ----
def f_of(kind, m):
    return 1 if kind == "1" else m if kind == "n" else m * m


F_EXP = {"1": 0, "n": 1, "n2": 2}
CASES = [
    ("merge sort", 2, 2, "n"),
    ("binary search", 1, 2, "1"),
    ("tree sum", 2, 2, "1"),
    ("split in 4, combine in n", 4, 2, "n"),
    ("expensive combine n^2", 2, 2, "n2"),
    ("naive matrix multiply", 8, 2, "n2"),
    ("Strassen", 7, 2, "n2"),
]


def recurrence(a, b, kind, k):
    n = b ** k
    levels = [a ** i * f_of(kind, n // b ** i) for i in range(k)]
    leaves = a ** k
    return sum(levels) + leaves, levels[0], leaves


def verdict(a, b, kind):
    c = F_EXP[kind]
    if a > b ** c:
        return "leaves dominate"
    if a == b ** c:
        return "every level costs the same"
    return "root dominates"


print("-- recurrence T(n) = a T(n/b) + f(n), total work, cost of the root level, cost of the leaf level")
for k in [10, 16]:
    print(f"  n = 2^{k} = {2 ** k}")
    for name, a, b, kind in CASES:
        total, root, leaves = recurrence(a, b, kind, k)
        print(f"    {name} (a={a}, b={b}, f={kind}): total {total}, root level {root}, leaf level {leaves}: {verdict(a, b, kind)}")


# ---- Work and span of merge sort (model, n = 2^k) ----
def work(k):
    return recurrence(2, 2, "n", k)[0]


def span_sequential_merge(k):
    return 2 ** (k + 1) - 1  # S(n) = S(n/2) + n, S(1) = 1


def span_parallel_merge(k):
    return 1 + sum(j * j for j in range(1, k + 1))  # model: merging m items has span (ceil log2 m)^2


print("-- parallel potential of merge sort: work, span, and the best possible time on p workers")
for k in [10, 20]:
    w, s1, s2 = work(k), span_sequential_merge(k), span_parallel_merge(k)
    print(f"  n = 2^{k}: work {w}; sequential merge: span {s1}, parallelism {w // s1}; parallel merge (model): span {s2}, parallelism {w // s2}")
    for p in [4, 16, 64, 1024]:
        wp = -(-w // p)
        print(f"    p={p}: sequential merge at least {max(wp, s1)} steps, parallel merge at least {max(wp, s2)} steps (work/p = {wp})")
