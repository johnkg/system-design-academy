# Two pointers and a sliding window, counted in steps (one pair checked, or one element added to or removed from a window).
# Look for: on a sorted list, two pointers find a pair in at most n - 1 checks where trying every pair needs n(n-1)/2;
# on positive numbers, a window finds the longest stretch with sum <= K in at most 2n steps; with negative numbers the
# same window code is fast but WRONG, and the only simple fix is back to the O(n^2) loops.
# Data comes from fixed integer formulas, so every language prints the same numbers.


def sorted_list(n):
    # strictly increasing: the steps between neighbours are 1 to 5
    return [3 * i + (i * 7 + 1) % 3 for i in range(n)]


def pair_brute(a, target):
    steps = 0
    for i in range(len(a)):
        for j in range(i + 1, len(a)):
            steps += 1
            if a[i] + a[j] == target:
                return steps, True
    return steps, False


def pair_two_pointers(a, target):
    lo, hi, steps = 0, len(a) - 1, 0
    while lo < hi:
        steps += 1
        s = a[lo] + a[hi]
        if s == target:
            return steps, True
        if s < target:
            lo += 1  # the pair (lo, anything left of hi) is too small
        else:
            hi -= 1  # the pair (anything right of lo, hi) is too big
    return steps, False


def values(n, mode):
    # positive: 1..9. mixed: -3..5, so some elements pull the sum back down.
    return [(i * 7 + 3) % 9 + (1 if mode == "positive" else -3) for i in range(n)]


def window_brute(v, k, mode):
    # Longest stretch with sum <= k. With positive numbers a sum can only grow, so each start stops at the first sum > k.
    # With negative numbers a later element can bring the sum back down, so each start must look at every end.
    best, steps = 0, 0
    for l in range(len(v)):
        s = 0
        for r in range(l, len(v)):
            s += v[r]
            steps += 1
            if s <= k:
                best = max(best, r - l + 1)
            elif mode == "positive":
                break
    return steps, best


def window_sliding(v, k):
    # The usual window: grow on the right, shrink from the left while the sum is too big.
    best, steps, l, s = 0, 0, 0, 0
    for r in range(len(v)):
        s += v[r]
        steps += 1
        while s > k and l <= r:
            s -= v[l]
            l += 1
            steps += 1
        best = max(best, r - l + 1)
    return steps, best


print("-- a pair that adds up to a target in a sorted list: every pair against two pointers")
for n in [10, 100, 1000, 10000]:
    a = sorted_list(n)
    for name, target in [("no pair exists", 1), ("a pair exists", a[n // 4] + a[3 * n // 4])]:
        bs, bf = pair_brute(a, target)
        ts, tf = pair_two_pointers(a, target)
        print(f"n={n} {name}: every pair {bs} checks (found {str(bf).lower()}), two pointers {ts} checks (found {str(tf).lower()})")

print("-- longest stretch with sum <= K: try every start against a sliding window")
for mode in ["positive", "mixed"]:
    for n in [10, 100, 1000, 10000]:
        v = values(n, mode)
        for k in [50, 500]:
            bs, bb = window_brute(v, k, mode)
            ws, wb = window_sliding(v, k)
            verdict = "same answer" if bb == wb else f"WRONG: window says {wb}, the true answer is {bb}"
            print(f"{mode} n={n} K={k}: try every start {bs} steps, window {ws} steps, {verdict}")
