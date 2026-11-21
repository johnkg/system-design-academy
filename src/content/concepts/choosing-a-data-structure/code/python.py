# Choosing a data structure: six structures run the same workload, and we count steps (element visits, comparisons, element moves).
# Look for: no structure wins every operation. The hash map has the cheapest lookup but must visit everything for a range; the sorted
# array has cheap range and smallest but pays for every insert; the heap only knows its smallest; the tree is never the worst.
# Counts are an explicit model: one step is one element visit, comparison, write or element shifted. Shifting the elements after an insert
# into an array is counted by length, because a real array does it with one bulk copy, which is typically much cheaper per element.
ops = 0
SPACE = 1000003  # keys are distinct integers below this prime: key(i) = (i * 7919 + 13) % SPACE


def key(i):
    return (i * 7919 + 13) % SPACE


class UnsortedArray:
    def __init__(self, keys, buckets):
        self.a = list(keys)

    def lookup(self, k):
        global ops
        for x in self.a:
            ops += 1
            if x == k:
                return 1
        return 0

    def insert(self, k):
        global ops
        ops += 1
        self.a.append(k)

    def range(self, lo, hi):
        global ops
        found = 0
        for x in self.a:
            ops += 1
            if lo <= x < hi:
                found += 1
        return found

    def smallest(self):
        global ops
        best = self.a[0]
        for x in self.a:
            ops += 1
            best = min(best, x)
        return best


class SortedArray:
    def __init__(self, keys, buckets):
        self.s = sorted(keys)

    def lower_bound(self, k):  # binary search, one comparison per halving
        global ops
        lo, hi = 0, len(self.s)
        while lo < hi:
            ops += 1
            mid = (lo + hi) // 2
            if self.s[mid] < k:
                lo = mid + 1
            else:
                hi = mid
        return lo

    def lookup(self, k):
        global ops
        i = self.lower_bound(k)
        ops += 1
        return 1 if i < len(self.s) and self.s[i] == k else 0

    def insert(self, k):
        global ops
        i = self.lower_bound(k)
        ops += 1 + len(self.s) - i  # the write, plus every later element shifted one place
        self.s.insert(i, k)

    def range(self, lo, hi):
        global ops
        i = self.lower_bound(lo)
        found = 0
        while i < len(self.s):
            ops += 1
            if self.s[i] >= hi:
                break
            found += 1
            i += 1
        return found

    def smallest(self):
        global ops
        ops += 1
        return self.s[0]


class Node:
    def __init__(self, k, nxt):
        self.k = k
        self.next = nxt


class LinkedList:
    def __init__(self, keys, buckets):
        self.head = None
        for k in keys:
            self.head = Node(k, self.head)

    def lookup(self, k):
        global ops
        n = self.head
        while n:
            ops += 1
            if n.k == k:
                return 1
            n = n.next
        return 0

    def insert(self, k):
        global ops
        ops += 1
        self.head = Node(k, self.head)

    def range(self, lo, hi):
        global ops
        found = 0
        n = self.head
        while n:
            ops += 1
            if lo <= n.k < hi:
                found += 1
            n = n.next
        return found

    def smallest(self):
        global ops
        best = self.head.k
        n = self.head
        while n:
            ops += 1
            best = min(best, n.k)
            n = n.next
        return best


class HashMap:  # chained buckets, sized once for the data it will hold (no resizing is counted)
    def __init__(self, keys, buckets):
        self.b = buckets
        self.t = [[] for _ in range(buckets)]
        self.count = 0
        for k in keys:
            self.t[k % self.b].append(k)
            self.count += 1

    def lookup(self, k):
        global ops
        ops += 1
        for x in self.t[k % self.b]:
            ops += 1
            if x == k:
                return 1
        return 0

    def insert(self, k):
        global ops
        ops += 1
        chain = self.t[k % self.b]
        for _x in chain:
            ops += 1  # a map must check that the key is not already there
        chain.append(k)
        self.count += 1

    def range(self, lo, hi):  # no order: visit every bucket and every element
        global ops
        ops += self.b + self.count
        return sum(1 for chain in self.t for x in chain if lo <= x < hi)

    def smallest(self):
        global ops
        ops += self.b + self.count
        return min(x for chain in self.t for x in chain)


class AvlNode:
    def __init__(self, k):
        self.k = k
        self.l = None
        self.r = None
        self.h = 1


def height(n):
    return n.h if n else 0


def update(n):
    n.h = 1 + max(height(n.l), height(n.r))


def rot_right(y):
    global ops
    ops += 1
    x = y.l
    y.l = x.r
    x.r = y
    update(y)
    update(x)
    return x


def rot_left(x):
    global ops
    ops += 1
    y = x.r
    x.r = y.l
    y.l = x
    update(x)
    update(y)
    return y


def avl_insert(n, k):
    global ops
    ops += 1  # one node visited, or the new node written
    if n is None:
        return AvlNode(k)
    if k < n.k:
        n.l = avl_insert(n.l, k)
    else:
        n.r = avl_insert(n.r, k)
    update(n)
    bal = height(n.l) - height(n.r)
    if bal > 1:
        if height(n.l.l) < height(n.l.r):
            n.l = rot_left(n.l)
        return rot_right(n)
    if bal < -1:
        if height(n.r.r) < height(n.r.l):
            n.r = rot_right(n.r)
        return rot_left(n)
    return n


class BalancedTree:  # an AVL tree
    def __init__(self, keys, buckets):
        self.root = None
        for k in keys:
            self.root = avl_insert(self.root, k)

    def lookup(self, k):
        global ops
        n = self.root
        while n:
            ops += 1
            if k == n.k:
                return 1
            n = n.l if k < n.k else n.r
        return 0

    def insert(self, k):
        self.root = avl_insert(self.root, k)

    def range(self, lo, hi):  # in-order walk that skips subtrees outside the range
        global ops
        found = 0

        def walk(n):
            nonlocal found
            global ops
            if n is None:
                return
            ops += 1
            if lo < n.k:
                walk(n.l)
            if lo <= n.k < hi:
                found += 1
            if n.k < hi:
                walk(n.r)

        walk(self.root)
        return found

    def smallest(self):
        global ops
        n = self.root
        while n.l:
            ops += 1
            n = n.l
        ops += 1
        return n.k


class MinHeap:  # array-based binary heap: knows its smallest, nothing else
    def __init__(self, keys, buckets):
        self.h = []
        for k in keys:
            self.insert(k)

    def lookup(self, k):
        global ops
        for x in self.h:
            ops += 1
            if x == k:
                return 1
        return 0

    def insert(self, k):
        global ops
        ops += 1
        self.h.append(k)
        i = len(self.h) - 1
        while i > 0:
            p = (i - 1) // 2
            ops += 1
            if self.h[p] > self.h[i]:
                self.h[p], self.h[i] = self.h[i], self.h[p]
                i = p
            else:
                break

    def range(self, lo, hi):
        global ops
        found = 0
        for x in self.h:
            ops += 1
            if lo <= x < hi:
                found += 1
        return found

    def smallest(self):
        global ops
        ops += 1
        return self.h[0]


STRUCTURES = [("unsorted array", UnsortedArray, 1), ("sorted array", SortedArray, 1), ("linked list", LinkedList, 2),
              ("hash map", HashMap, 1), ("balanced tree", BalancedTree, 2), ("binary heap", MinHeap, 1)]  # third field: 2 = follows pointers


def run(cls, n, lookups, inserts, ranges, smallests):
    """Returns (steps for lookups, inserts, ranges, smallest queries, key results found)."""
    global ops
    s = cls([key(i) for i in range(n)], 2 * (n + inserts) + 1)
    out = []
    found = 0
    ops = 0
    for t in range(lookups):
        found += s.lookup(key((t * 37 + 11) % n))
    lk = ops
    ops = 0
    width = 10 * SPACE // n  # about 10 keys fall in a range this wide
    for t in range(ranges):
        lo = (t * 104729) % SPACE
        found += s.range(lo, lo + width)
    rg = ops
    ops = 0
    for t in range(smallests):
        found += 1 if s.smallest() >= 0 else 0
    sm = ops
    ops = 0
    for t in range(inserts):
        s.insert(key(n + t))
    ins = ops
    return lk, ins, rg, sm, found


MIXES = [("lookup-heavy", 1000, 10, 0, 0), ("insert-heavy", 10, 1000, 0, 0), ("range reports", 20, 5, 500, 0),
         ("priority queue", 0, 500, 0, 500), ("mixed", 200, 200, 200, 200)]

agree = True
for n in [100, 1000, 10000]:
    print(f"n={n}, 100 of each operation:")
    founds = set()
    for name, cls, _p in STRUCTURES:
        lk, ins, rg, sm, found = run(cls, n, 100, 100, 100, 100)
        founds.add(found)
        print(f"  {name}: lookup {lk}, insert {ins}, range {rg}, smallest {sm}, total {lk + ins + rg + sm}")
    agree = agree and len(founds) == 1
print(f"all six structures return the same results: {'yes' if agree else 'no'}")

for mix, l, i, r, m in MIXES:
    totals = []
    for name, cls, _p in STRUCTURES:
        lk, ins, rg, sm, _f = run(cls, 1000, l, i, r, m)
        totals.append(lk + ins + rg + sm)
    best = min(range(6), key=lambda x: totals[x])
    cells = ", ".join(f"{STRUCTURES[x][0]} {totals[x]}" for x in range(6))
    print(f"{mix} ({l} lookups, {i} inserts, {r} ranges, {m} smallest) at n=1000: {cells}; fewest steps: {STRUCTURES[best][0]}")

# Cache caveat: counts treat every step alike. If following a pointer costs 4 times an array step, the range-reports mix changes.
totals = []
for name, cls, pointer in STRUCTURES:
    lk, ins, rg, sm, _f = run(cls, 1000, 20, 5, 500, 0)
    totals.append((lk + ins + rg + sm) * (4 if pointer == 2 else 1))
best = min(range(6), key=lambda x: totals[x])
print("range reports at n=1000 with pointer steps weighted 4: " + ", ".join(f"{STRUCTURES[x][0]} {totals[x]}" for x in range(6)) + f"; fewest: {STRUCTURES[best][0]}")
