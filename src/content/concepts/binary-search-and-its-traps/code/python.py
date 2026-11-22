# Binary search, counted in probes (one probe = one look at an item), never in time.
# Look for: halving needs about log2 n probes where a scan needs up to n; the textbook "find any match" version returns
# SOME copy of a duplicated value, not the first; the "lo = mid" off-by-one hangs only on some inputs; a 32-bit
# "(lo + hi) / 2" goes negative once the range is big; and the same halving works on an answer space, no array needed.
# The list is never built: item i of the sorted list is (i // run) * 2 + 1, so every value appears `run` times (odd values only).

CAP = 64  # the buggy search is stopped after this many probes, so the program still ends


def at(i, run):
    return (i // run) * 2 + 1


def first_index(v, run):
    return ((v - 1) // 2) * run


def linear(n, run, t):
    # Scans from the left and stops at the first match, so it also finds the first occurrence.
    for i in range(n):
        if at(i, run) == t:
            return i + 1, i
    return n, -1


def binary_any(n, run, t):
    # Textbook version: stop at the first probe that hits the target.
    lo, hi, probes = 0, n - 1, 0
    while lo <= hi:
        mid = lo + (hi - lo) // 2
        probes += 1
        v = at(mid, run)
        if v == t:
            return probes, mid
        if v < t:
            lo = mid + 1
        else:
            hi = mid - 1
    return probes, -1


def lower_bound(n, run, t):
    # Half-open range [lo, hi): keeps halving until it finds the first position whose value is >= t, then checks it (one more probe).
    lo, hi, probes = 0, n, 0
    while lo < hi:
        mid = lo + (hi - lo) // 2
        probes += 1
        if at(mid, run) < t:
            lo = mid + 1
        else:
            hi = mid
    probes += 1
    if lo < n and at(lo, run) == t:
        return probes, lo
    return probes, -1


def buggy(n, run, t):
    # "lo = mid" instead of "lo = mid + 1": when lo and hi are neighbours, mid == lo and nothing changes. Returns (probes, stuck).
    lo, hi, probes = 0, n - 1, 0
    while lo < hi and probes < CAP:
        mid = lo + (hi - lo) // 2
        probes += 1
        if at(mid, run) < t:
            lo = mid
        else:
            hi = mid
    return probes, lo < hi


print("-- probes to find a target in a sorted list of n items, each value repeated `run` times")
for run in [1, 4]:
    for n in [10, 1000, 1000000]:
        for name, t in [("first", at(0, run)), ("last", at(n - 1, run)), ("middle", at(n // 2, run)), ("missing", 2)]:
            lc, lp = linear(n, run, t)
            bc, bp = binary_any(n, run, t)
            oc, op = lower_bound(n, run, t)
            gc, stuck = buggy(n, run, t)
            first = first_index(t, run) if lp >= 0 else -1
            ok = "not found" if bp < 0 else ("first copy" if bp == first else "a later copy")
            g = "stuck, gave up at %d probes" % gc if stuck else "%d probes" % gc
            print(f"run={run} n={n} {name}: linear {lc}, binary-any {bc} (index {bp}, {ok}), lower-bound {oc} (index {op}), lo=mid bug: {g}")

print("-- the midpoint in 32-bit signed integers")


def wrap32(x):
    x &= 0xFFFFFFFF
    return x - 4294967296 if x >= 2147483648 else x


for lo, hi in [(1000000000, 1100000000), (1500000000, 2000000000), (2000000000, 2100000000)]:
    s = wrap32(lo + hi)
    print(f"lo={lo} hi={hi}: (lo + hi) is {s}, naive mid {s // 2}, safe mid {lo + (hi - lo) // 2}")


def weight(i):
    return 1 + (i * 37 + 11) % 20


def days_needed(n, cap):
    days, load = 1, 0
    for i in range(n):
        w = weight(i)
        if load + w > cap:
            days += 1
            load = 0
        load += w
    return days


print("-- searching an answer space: the smallest ship capacity that moves n packages, in order, within D days")
for n in [100, 1000]:
    for d in [3, 10]:
        heaviest = max(weight(i) for i in range(n))
        total = sum(weight(i) for i in range(n))
        lo, hi, probes = heaviest, total, 0
        while lo < hi:
            mid = lo + (hi - lo) // 2
            probes += 1
            if days_needed(n, mid) <= d:
                hi = mid
            else:
                lo = mid + 1
        tries = lo - heaviest + 1
        print(f"n={n} days={d}: capacity {lo} (searched {heaviest} to {total}), binary {probes} checks = {probes * n} steps, counting up from {heaviest}: {tries} checks = {tries * n} steps")
