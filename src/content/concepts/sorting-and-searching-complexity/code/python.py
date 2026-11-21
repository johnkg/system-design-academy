# Sorting and searching, counted in comparisons (and steps for counting sort), never in time.
# Look for: insertion sort and first-element quicksort are quadratic on some inputs, merge sort is about n log n on all of
# them, a heap finds the top 10 with far fewer comparisons than a full sort, and sorting only pays for searching after enough searches.
# The "random" input comes from a fixed integer generator, so every language prints the same numbers.
import math


def make_input(pattern, n):
    a = []
    x = 12345
    for i in range(n):
        x = (x * 1664525 + 1013904223) % 4294967296
        r = (x // 65536) % 100000
        a.append(i + 1 if pattern == "sorted" else n - i if pattern == "reversed" else r % 10 if pattern == "duplicates" else r)
    return a


def ident(v):
    return v


# Every sort returns the number of comparisons of two keys. key_of says what to compare, so records can be sorted by one field.
def insertion_sort(a, key_of=ident):
    count = 0
    for i in range(1, len(a)):
        v = a[i]
        j = i
        while j > 0:
            count += 1
            if key_of(a[j - 1]) > key_of(v):
                a[j] = a[j - 1]
                j -= 1
            else:
                break
        a[j] = v
    return count


def merge_sort(a, key_of=ident):
    count = [0]

    def sort(lo, hi):  # sorts a[lo:hi]
        if hi - lo < 2:
            return
        mid = (lo + hi) // 2
        sort(lo, mid)
        sort(mid, hi)
        left, right = a[lo:mid], a[mid:hi]
        i = j = 0
        k = lo
        while i < len(left) and j < len(right):
            count[0] += 1
            if key_of(right[j]) < key_of(left[i]):  # ties take the left one: stable
                a[k] = right[j]
                j += 1
            else:
                a[k] = left[i]
                i += 1
            k += 1
        while i < len(left):
            a[k] = left[i]
            i += 1
            k += 1
        while j < len(right):
            a[k] = right[j]
            j += 1
            k += 1

    sort(0, len(a))
    return count[0]


# Quicksort with the FIRST element as pivot (a naive choice), Lomuto partition, explicit stack so deep recursion cannot overflow.
def quick_sort(a, key_of=ident):
    count = 0
    stack = [(0, len(a) - 1)]
    while stack:
        lo, hi = stack.pop()
        if lo >= hi:
            continue
        pivot = key_of(a[lo])
        i = lo
        for j in range(lo + 1, hi + 1):
            count += 1
            if key_of(a[j]) < pivot:
                i += 1
                a[i], a[j] = a[j], a[i]
        a[lo], a[i] = a[i], a[lo]
        stack.append((lo, i - 1))
        stack.append((i + 1, hi))
    return count


# Counting sort: no comparisons at all. Steps = n to count, (largest key + 1) to scan the counts, n to write out.
def counting_sort(a):
    mx = max(a + [0])
    counts = [0] * (mx + 1)
    steps = 0
    for v in a:
        counts[v] += 1
        steps += 1
    for v in range(mx + 1):
        steps += 1
        for _ in range(counts[v]):
            steps += 1
    return steps


# Top k with a min-heap of size k: n log k instead of n log n. Counts comparisons, sift-up and sift-down included.
def top_k(a, k):
    count = [0]
    h = []

    def sift_up(i):
        while i > 0:
            p = (i - 1) >> 1
            count[0] += 1
            if h[i] < h[p]:
                h[i], h[p] = h[p], h[i]
                i = p
            else:
                break

    def sift_down(i):
        while True:
            l = 2 * i + 1
            r = l + 1
            if l >= len(h):
                break
            s = l
            if r < len(h):
                count[0] += 1
                if h[r] < h[l]:
                    s = r
            count[0] += 1
            if h[s] < h[i]:
                h[i], h[s] = h[s], h[i]
                i = s
            else:
                break

    for x in a:
        if len(h) < k:
            h.append(x)
            sift_up(len(h) - 1)
        else:
            count[0] += 1
            if x > h[0]:
                h[0] = x
                sift_down(0)
    return count[0], sorted(h, reverse=True)


print("-- comparisons to sort n items (counting sort: steps)")
for n in [10, 100, 1000]:
    for pattern in ["random", "sorted", "reversed", "duplicates"]:
        base = make_input(pattern, n)
        ins, mer, qs, cs = insertion_sort(list(base)), merge_sort(list(base)), quick_sort(list(base)), counting_sort(base)
        print(f"n={n} {pattern}: insertion {ins}, merge {mer}, quicksort(first pivot) {qs}, counting steps {cs}, top-10 heap {top_k(base, 10)[0]}")

# The sorts really sort, and the heap really finds the 10 largest.
a = make_input("random", 1000)
srt = list(a)
merge_sort(srt)
for f in (insertion_sort, quick_sort):
    b = list(a)
    f(b)
    if b != srt:
        raise Exception("not sorted")
expected = srt[-10:][::-1]
print(f"-- heap top 10 equals the last 10 of the full sort: {'true' if top_k(a, 10)[1] == expected else 'false'}")


# Binary search: one comparison per probe. Linear search: one per element looked at. Both look for the LAST element.
def binary_search(a, target):
    lo, hi, count = 0, len(a) - 1, 0
    while lo <= hi:
        mid = (lo + hi) // 2
        count += 1
        if a[mid] == target:
            return count
        if a[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return count


# The classic bug: "lo = mid" instead of "lo = mid + 1" never makes progress when lo and mid meet. Capped at 50 probes here.
def buggy_binary_search(a, target):
    lo, hi, count = 0, len(a) - 1, 0
    while lo < hi and count < 50:
        mid = (lo + hi) // 2
        count += 1
        if a[mid] < target:
            lo = mid
        else:
            hi = mid
    return count


print("-- searching for the last item of a sorted list")
for n in [10, 1000, 1000000]:
    a = make_input("sorted", n)
    linear = 0
    for i in range(n):
        linear += 1
        if a[i] == n:
            break
    print(f"n={n}: linear {linear} comparisons, binary {binary_search(a, n)}")
print(f"buggy binary search (lo = mid) on 10 items: {buggy_binary_search(make_input('sorted', 10), 10)} probes, then gave up at the cap of 50")

# Sorting once to search many times: sort cost against the saving of binary over linear search (average linear cost about n/2).
print("-- searches needed before sorting first pays off")
for n in [100, 1000, 10000]:
    sort_cost = merge_sort(make_input("random", n))
    linear, binary = math.ceil(n / 2), n.bit_length()
    q = 1
    while sort_cost + q * binary >= q * linear:
        q += 1
    print(f"n={n}: sort {sort_cost}, linear {linear} per search, binary {binary} per search, break-even at {q} searches")

# Traps: sorting to find the minimum, sorting inside a loop, a key recomputed in every comparison.
print("-- traps")
n = 1000
a = make_input("random", n)
sort_cost = merge_sort(list(a))
print(f"minimum of {n}: a scan needs {n - 1} comparisons, sorting first needs {sort_cost}")
print(f"100 lookups that each re-sort {n} items: {100 * sort_cost} comparisons; sorting once: {sort_cost}")
print(f"sort {n} items by a computed key: {2 * sort_cost} key computations if the comparator recomputes both keys, {n} if keys are computed once first")

# Stability: records are key*1000 + id. Equal keys should keep their original order (ids ascending).
print("-- stability: ids of the records after sorting by key")
records = [2001, 1002, 2003, 1004, 2005, 1006, 2007, 1008]


def key(v):
    return v // 1000


def ids(a):
    return " ".join(str(v % 1000) for v in a)


i = list(records)
insertion_sort(i, key)
m = list(records)
merge_sort(m, key)
q = list(records)
quick_sort(q, key)
print(f"insertion (stable): {ids(i)}")
print(f"merge (stable): {ids(m)}")
print(f"quicksort (not stable): {ids(q)}")
