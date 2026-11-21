# Big O: count operations (one comparison or one element visit each), never time, for five algorithms at growing n.
# Look for: the counts grow at different rates. Doubling n makes the n^2 check cost 4x, while binary search barely moves.
ops = 0


def linear_search(a, target):  # worst case: the target is not there, so every element is visited
    global ops
    ops = 0
    for x in a:
        ops += 1
        if x == target:
            break
    return ops


def binary_search(a, target):  # one comparison per halving of the range
    global ops
    ops = 0
    lo, hi = 0, len(a) - 1
    while lo <= hi:
        ops += 1
        mid = (lo + hi) // 2
        if a[mid] == target:
            break
        if a[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return ops


def has_duplicate_nested(a):  # compares every pair once; no duplicates here, so it never stops early
    global ops
    ops = 0
    for i in range(len(a)):
        for j in range(i + 1, len(a)):
            ops += 1
            if a[i] == a[j]:
                return ops
    return ops


def merge_sort(a):  # counts the comparisons made while merging
    global ops
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left, right = merge_sort(a[:mid]), merge_sort(a[mid:])
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        ops += 1
        if left[i] <= right[j]:
            out.append(left[i])
            i += 1
        else:
            out.append(right[j])
            j += 1
    out.extend(left[i:])
    out.extend(right[j:])
    return out


def count_subsets(n):  # visits every subset of n items: 2^n of them
    global ops
    ops = 0
    for _mask in range(2 ** n):
        ops += 1
    return ops


for n in [10, 100, 1000]:
    data = [(i * 7919) % n for i in range(n)]  # a fixed shuffle of 0..n-1, no duplicates
    ordered = list(range(n))
    linear = linear_search(data, -1)
    binary = binary_search(ordered, n)  # absent and larger than everything: worst case
    nested = has_duplicate_nested(data)
    ops = 0
    merge_sort(data)
    srt = ops
    print(f"n={n}: linear search {linear}, binary search {binary}, nested duplicate check {nested}, merge sort {srt}")
for n in [10, 15, 20]:
    print(f"subsets of {n} items: {count_subsets(n)} visited")

# A constant factor: an O(n) algorithm that does 100 steps per item against a plain O(n^2) one.
n = 1
while not (100 * n < n * n):
    n += 1
print(f"100n beats n^2 only from n = {n}")
