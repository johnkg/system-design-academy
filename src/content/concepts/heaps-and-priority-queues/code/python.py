# A binary min-heap (a priority queue stored in a flat array), with every comparison counted instead of timed.
# Look for: building a heap bottom-up costs under 2n comparisons where pushing one at a time costs up to n log n; top-k
# with a heap of size k beats a full sort when k is small and loses its edge when k is large; an array kept sorted or
# unsorted makes one of push and pop cost O(n); decrease-key needs to know where an item is; a priority that never ages starves.
# A "step" is one element examined (compared, and maybe moved). The lists come from a fixed integer generator.

ID_SPACE = 100000  # a heap entry is priority * ID_SPACE + id, so equal priorities are ordered by id and every key is unique


def make_input(pattern, n):
    a, x = [], 12345
    for i in range(n):
        x = (x * 1664525 + 1013904223) % 4294967296
        r = (x // 65536) % 100000
        a.append(n - i if pattern == "descending" else i + 1 if pattern == "ascending" else r)
    return a


class Heap:
    def __init__(self, track_positions=0):
        self.a = []
        self.c = 0  # comparisons so far
        self.pos = [0] * track_positions if track_positions else None  # where each id sits, for decrease-key

    def _put(self, i, key):
        self.a[i] = key
        if self.pos is not None:
            self.pos[key % ID_SPACE] = i

    def sift_up(self, i):
        key = self.a[i]
        while i > 0:
            p = (i - 1) // 2
            self.c += 1
            if key < self.a[p]:
                self._put(i, self.a[p])
                i = p
            else:
                break
        self._put(i, key)

    def sift_down(self, i):
        key, n = self.a[i], len(self.a)
        while True:
            s = 2 * i + 1
            if s >= n:
                break
            if s + 1 < n:
                self.c += 1
                if self.a[s + 1] < self.a[s]:
                    s += 1
            self.c += 1
            if self.a[s] < key:
                self._put(i, self.a[s])
                i = s
            else:
                break
        self._put(i, key)

    def push(self, key):
        self.a.append(key)
        self.sift_up(len(self.a) - 1)

    def pop(self):
        top, last = self.a[0], self.a.pop()
        if self.a:
            self.a[0] = last
            self.sift_down(0)
        return top

    def heapify(self, items):  # bottom-up: sift down every parent, last parent first
        self.a = list(items)
        if self.pos is not None:
            for i, key in enumerate(self.a):
                self.pos[key % ID_SPACE] = i
        for i in range(len(self.a) // 2 - 1, -1, -1):
            self.sift_down(i)


def merge_sort_count(a):
    count = [0]

    def sort(v):
        if len(v) < 2:
            return v
        left, right = sort(v[: len(v) // 2]), sort(v[len(v) // 2:])
        out, i, j = [], 0, 0
        while i < len(left) and j < len(right):
            count[0] += 1
            if right[j] < left[i]:
                out.append(right[j])
                j += 1
            else:
                out.append(left[i])
                i += 1
        return out + left[i:] + right[j:]

    sort(a)
    return count[0]


print("-- building a heap of n items: n pushes against bottom-up heapify (comparisons)")
for n in [10, 100, 1000, 10000]:
    for pattern in ["random", "descending"]:
        a = make_input(pattern, n)
        h = Heap()
        for v in a:
            h.push(v)
        g = Heap()
        g.heapify(a)
        per = g.c * 100 // n
        print(f"n={n} {pattern}: pushes {h.c}, heapify {g.c} ({per // 100}.{per % 100:02d} per item)")

print("-- the k largest of n items: a heap of size k against sorting everything (comparisons)")
for n in [1000, 10000]:
    for k in [10, 100, n // 2]:
        row = []
        for pattern in ["random", "ascending"]:
            a = make_input(pattern, n)
            h = Heap()
            h.heapify(a[:k])  # a min-heap of the k largest so far: its root is the smallest of them
            for x in a[k:]:
                h.c += 1
                if x > h.a[0]:
                    h.a[0] = x
                    h.sift_down(0)
            row.append(f"{pattern} input {h.c}")
        print(f"n={n} k={k}: heap: {', '.join(row)}; full merge sort {merge_sort_count(make_input('random', n))}")

print("-- n pushes then n pops, three ways to store a priority queue (steps)")
for n in [10, 100, 1000, 10000]:
    a = make_input("random", n)
    u, steps_u = [], 0  # unsorted array: push is free, pop scans everything for the minimum
    for v in a:
        u.append(v)
        steps_u += 1
    while u:
        steps_u += len(u)
        u.remove(min(u))  # removing the minimum, written as a scan: len(u) steps
    s, steps_s = [], 0  # array kept sorted (largest first): insertion shifts items, pop takes the last one
    for v in a:
        s.append(v)
        j = len(s) - 1
        while j > 0:
            steps_s += 1
            if s[j - 1] < v:
                s[j] = s[j - 1]
                j -= 1
            else:
                break
        s[j] = v
    while s:
        s.pop()
        steps_s += 1
    h = Heap()
    for v in a:
        h.push(v)
    while h.a:
        h.pop()
    print(f"n={n}: unsorted array {steps_u}, sorted array {steps_s}, heap {h.c}")

print("-- n decrease-key updates, then drain: where is the item?")


def prio(i):
    return 20000 + (i * 7919) % 10007


def lowered(i):
    return prio(i) - 1 - (i * 4999) % 15000


for n in [100, 1000, 10000]:
    start = [prio(i) * ID_SPACE + i for i in range(n)]
    # (a) the heap knows each item's position: change the key and sift it up
    h = Heap(n)
    h.heapify(start)
    base = h.c
    for i in range(n):
        j = h.pos[i]
        h.a[j] = lowered(i) * ID_SPACE + i
        h.sift_up(j)
    upd_a = h.c - base
    order_a = []
    while h.a:
        order_a.append(h.pop() % ID_SPACE)
    drain_a = h.c - base - upd_a
    # (b) no position index: scan the array for the item first
    g = Heap()
    g.heapify(start)
    base = g.c
    scan = 0
    for i in range(n):
        j = 0
        while g.a[j] % ID_SPACE != i:
            j += 1
        scan += j + 1
        g.a[j] = lowered(i) * ID_SPACE + i
        g.sift_up(j)
    upd_b = g.c - base + scan
    order_b = []
    while g.a:
        order_b.append(g.pop() % ID_SPACE)
    drain_b = g.c - base - (upd_b - scan)
    # (c) lazy: push a second entry with the new priority, leave the old one, skip stale entries when they surface
    z = Heap()
    z.heapify(start)
    base = z.c
    current = [prio(i) for i in range(n)]
    for i in range(n):
        current[i] = lowered(i)
        z.push(current[i] * ID_SPACE + i)
    upd_c, peak = z.c - base, len(z.a)
    order_c, seen, stale = [], [False] * n, 0
    while z.a:
        key = z.pop()
        i = key % ID_SPACE
        if key // ID_SPACE != current[i] or seen[i]:
            stale += 1
        else:
            seen[i] = True
            order_c.append(i)
    drain_c = z.c - base - upd_c
    if not (order_a == order_b == order_c):
        raise Exception("the three methods disagree")
    print(f"n={n}: indexed {upd_a} + {drain_a} = {upd_a + drain_a}; scan to find {upd_b} + {drain_b} = {upd_b + drain_b}; lazy duplicates {upd_c} + {drain_c} = {upd_c + drain_c} (heap grew to {peak}, {stale} stale entries popped)")

print("-- a scheduler that serves one task per tick: does a priority-9 task from tick 0 ever run?")
for age in [1000000, 100, 50, 10]:
    # key = priority * age + arrival tick: a larger `age` means priority dominates; no aging is age = 1,000,000
    h = Heap()
    h.push((9 * age + 0) * 10000 + 0)
    served = None
    for t in range(1, 2001):
        p = (t * 7 + 3) % 5 + 1  # arrivals are priorities 1 to 5
        h.push((p * age + t) * 10000 + t)
        if h.pop() % 10000 == 0 and served is None:
            served = t
            break
    label = "never within 2000 ticks" if served is None else f"served at tick {served}"
    print(f"{'no aging' if age == 1000000 else f'aging: one priority level = {age} ticks'}: {label}")
