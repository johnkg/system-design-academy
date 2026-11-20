# Naive recursion vs memoization vs bottom-up tabulation, counted in function calls, cache entries and stack depth.
# Every problem is described by one function: given a state (an integer key), which sub-states does it call?
# Look for: naive calls explode with n while memoized calls grow in step with the number of distinct states;
# the tree sum has NO overlapping subproblems, so its cache is pure overhead; greedy gives wrong coin answers.
import sys

sys.setrecursionlimit(10000)  # Python's default limit is 1000 frames; the model recurses as deep as the input
CAP = 10**15  # naive counts above this are reported as "more than 1e15"


def fib():
    return dict(start=lambda n: n, children=lambda k, n: [] if k < 2 else [k - 1, k - 2], cells=lambda n: n + 1)


# A grid state is r*1000 + c: paths from (r,c) to the edge (r=0 or c=0), moving up or left one step at a time.
def grid():
    return dict(start=lambda n: n * 1000 + n,
                children=lambda k, n: [] if k // 1000 == 0 or k % 1000 == 0 else [k - 1000, k - 1],
                cells=lambda n: (n + 1) * (n + 1))


# Fewest coins for an amount: every coin that fits is a sub-call.
def coins(cs):
    return dict(start=lambda n: n, children=lambda a, n: [] if a == 0 else [a - c for c in cs if c <= a], cells=lambda n: n + 1)


# Same problem, but the cache key also holds "coins used so far" (key = amount*1000 + used): too much state in the key.
def coins_bad_key(cs):
    def children(k, n):
        a, u = k // 1000, k % 1000
        return [] if a == 0 else [(a - c) * 1000 + u + 1 for c in cs if c <= a]
    return dict(start=lambda n: n * 1000, children=children, cells=lambda n: n + 1)


# A complete binary tree of the given depth, nodes numbered like a heap (root 1, children 2i and 2i+1): summing it never revisits a node.
def tree():
    return dict(start=lambda n: 1, children=lambda i, d: [] if i.bit_length() - 1 >= d else [2 * i, 2 * i + 1], cells=lambda d: 2 ** (d + 1) - 1)


# Calls made by the NAIVE recursion, without running it: calls(state) = 1 + sum of calls(children), with a table
# so that 2^n calls are never executed. Saturates at CAP.
def naive(p, n):
    memo = {}

    def calls(k):
        if k in memo:
            return memo[k]
        total = 1
        for c in p["children"](k, n):
            total = min(CAP, total + calls(c))
        memo[k] = total
        return total

    return calls(p["start"](n))


# Longest chain of nested calls (stack frames) of the recursion, same table trick.
def depth(p, n):
    memo = {}

    def d(k):
        if k in memo:
            return memo[k]
        best = 0
        for c in p["children"](k, n):
            best = max(best, d(c))
        memo[k] = best + 1
        return best + 1

    return d(p["start"](n))


# The memoized recursion, really executed: a call that finds its key in the cache returns at once.
def memoized(p, n):
    cache = set()
    calls = [0]

    def f(k):
        calls[0] += 1
        if k in cache:
            return
        for c in p["children"](k, n):
            f(c)
        cache.add(k)

    f(p["start"](n))
    return calls[0], len(cache)


# The naive recursion, really executed, to check that the counting model above is exact.
def run_naive(p, n):
    calls = [0]

    def f(k):
        calls[0] += 1
        for c in p["children"](k, n):
            f(c)

    f(p["start"](n))
    return calls[0]


def fmt(x):
    return "more than 1e15" if x >= CAP else str(x)


def report(label, p, sizes):
    print(f"-- {label}")
    for n in sizes:
        mc, me = memoized(p, n)
        print(f"  n={n}: naive {fmt(naive(p, n))} calls, memoized {mc} calls and {me} entries, bottom-up {p['cells'](n)} cells, stack depth {depth(p, n)}")


report("Fibonacci", fib(), [10, 20, 30, 40])
report("Grid paths, n x n", grid(), [4, 8, 12, 16])
report("Coin change {1,5,10,25}", coins([1, 5, 10, 25]), [30, 60, 90])
report("Coin change {1,5,10,25} with a bad cache key (amount, coins used)", coins_bad_key([1, 5, 10, 25]), [30, 60])
report("Sum of a complete tree of depth n (nothing overlaps)", tree(), [5, 10, 15])

print("-- the model is exact: running the naive recursion gives the same count")
for label, p, n in [("fib 20", fib(), 20), ("grid 8", grid(), 8), ("coins 40", coins([1, 5, 10, 25]), 40), ("tree 10", tree(), 10)]:
    ran, modelled = run_naive(p, n), naive(p, n)
    print(f"  {label}: run {ran}, model {modelled}, {'same' if ran == modelled else 'DIFFERENT'}")


# Smallest n where the naive recursion needs more than one billion calls.
def billion(p, limit):
    for n in range(1, limit + 1):
        if naive(p, n) > 10**9:
            return n
    return -1


print("-- first n where naive recursion passes 1,000,000,000 calls")
print(f"  Fibonacci: n={billion(fib(), 100)}")
print(f"  Grid paths: n={billion(grid(), 40)}")
print(f"  Coins {{1,5,10,25}}: amount={billion(coins([1, 5, 10, 25]), 500)}")
print(f"  Coins {{1,3,4}}: amount={billion(coins([1, 3, 4]), 500)}")
tree_depth = 1
while 2 ** (tree_depth + 1) - 1 <= 10**9:
    tree_depth += 1
print(f"  Tree: depth={tree_depth}")


# Greedy (take the biggest coin that fits) against the optimum (bottom-up table).
def greedy(cs, amount):
    left, used = amount, 0
    for c in sorted(cs, reverse=True):
        used += left // c
        left %= c
    return used


def best(cs, amount):
    t = [0]
    for a in range(1, amount + 1):
        t.append(min(t[a - c] + 1 for c in cs if c <= a))
    return t[amount]


print("-- greedy against optimal")
for cs, amount in [([1, 5, 10, 25], 63), ([1, 3, 4], 6), ([1, 7, 10], 14), ([1, 5, 12], 15)]:
    g, o = greedy(cs, amount), best(cs, amount)
    print(f"  coins {{{','.join(map(str, cs))}}} amount {amount}: greedy {g}, optimal {o}{'' if g == o else ' (greedy is wrong)'}")
