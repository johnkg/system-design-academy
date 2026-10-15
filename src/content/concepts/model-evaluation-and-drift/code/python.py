# Paired comparison of an old and a new model on the same seeded eval set, with a normal-approximation CI,
# a bootstrap CI and a release gate. Everything is integer arithmetic except the final square root.
import math


def lcg(seed):
    x = [seed]

    def nxt():
        x[0] = (x[0] * 48271) % 2147483647
        return x[0]
    return nxt


# Item i is hard or easy (z). Each model passes when z plus its own run-to-run noise is under a threshold.
def eval_set(n, delta_pts):
    r = lcg(20240601)
    d = []
    pass_old = pass_new = 0
    for _ in range(n):
        z = r() % 1000
        noise_old = (r() % 301) - 150
        noise_new = (r() % 301) - 150
        o = 1 if z + noise_old < 700 else 0
        w = 1 if z + noise_new < 700 + delta_pts * 10 else 0
        pass_old += o
        pass_new += w
        d.append(w - o)  # per-item paired difference: -1, 0 or +1
    return d, pass_old, pass_new


def fmt(v):  # fraction -> percentage points, 2 decimals, round half up, same in every language
    x = v * 100
    k = math.floor(abs(x) * 100 + 0.5)
    return ("-" if x < 0 and k > 0 else "") + str(k // 100) + "." + str(k % 100).zfill(2)


def compare(n, delta_pts):
    d, pass_old, pass_new = eval_set(n, delta_pts)
    total = sum(d)
    sum_sq = sum(v * v for v in d)
    mean = total / n
    se = math.sqrt((sum_sq - n * mean * mean) / (n - 1) / n)  # paired standard error
    p1, p2 = pass_old / n, pass_new / n
    se_unpaired = math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / n)  # what you would get by ignoring the pairing
    r = lcg(7)
    sums = []
    for _ in range(1000):
        t = 0
        for _ in range(n):
            t += d[r() % n]
        sums.append(t)
    sums.sort()
    lo, hi = mean - 1.96 * se, mean + 1.96 * se
    b_lo, b_hi = sums[25] / n, sums[974] / n  # 2.5th and 97.5th percentile of 1000 resamples
    gate = "ship" if lo > -0.02 else "block"  # non-inferiority: lower bound not below -2 points
    label = "better" if lo > 0 else "worse" if hi < 0 else "inconclusive"
    print(f"n={n:>4} change={'+' if delta_pts >= 0 else ''}{delta_pts} old={fmt(p1)}% new={fmt(p2)}% diff={fmt(mean)}")
    print(f"  normal CI {fmt(lo)}..{fmt(hi)}  bootstrap CI {fmt(b_lo)}..{fmt(b_hi)}  paired width {fmt(hi - lo)} vs unpaired {fmt(2 * 1.96 * se_unpaired)}")
    print(f"  verdict: {label}, gate: {gate}")
    if not (lo <= mean <= hi and b_lo <= mean <= b_hi):
        raise SystemExit("mean outside its own interval")
    if not (hi - lo < 2 * 1.96 * se_unpaired):
        raise SystemExit("pairing should narrow the interval")
    return hi - lo, gate


small = compare(100, 3)
large = compare(1000, 3)
compare(1000, -3)
compare(200, 0)
if not (large[0] < small[0]):
    raise SystemExit("more items must narrow the interval")
print(f"gate at n=100: {small[1]}, at n=1000: {large[1]}")
