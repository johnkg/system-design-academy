# Paired comparison of an old and a new model on the same seeded eval set, with a normal-approximation CI,
# a bootstrap CI and a release gate. Everything is integer arithmetic except the final square root.
import math

EVAL_SEED, BOOTSTRAP_SEED = 20240601, 7
DIFFICULTY_RANGE = 1000  # item difficulty z is 0..999
NOISE = 150  # run-to-run noise is -150..+150
PASS_BELOW = 700  # a model passes an item when z + noise is under this (about 70% accuracy)
DIFFICULTY_PER_PT = DIFFICULTY_RANGE // 100  # one accuracy point moves the threshold by 10
RESAMPLES = 1000
TAIL = RESAMPLES // 40  # bootstrap resamples, 2.5% of them in each tail
Z95 = 1.96  # two-sided 95% normal quantile
NON_INFERIORITY = 0.02  # ship unless the new model may be more than 2 points worse
SMALL_N, LARGE_N, GAIN_PTS = 100, 1000, 3


def lcg(seed):
    x = [seed]

    def nxt():
        x[0] = (x[0] * 48271) % 2147483647
        return x[0]
    return nxt


# Item i is hard or easy (z). Each model passes when z plus its own run-to-run noise is under a threshold.
def eval_set(n, delta_pts):
    r = lcg(EVAL_SEED)
    d = []
    pass_old = pass_new = 0
    for _ in range(n):
        z = r() % DIFFICULTY_RANGE
        noise_old = (r() % (2 * NOISE + 1)) - NOISE
        noise_new = (r() % (2 * NOISE + 1)) - NOISE
        o = 1 if z + noise_old < PASS_BELOW else 0
        w = 1 if z + noise_new < PASS_BELOW + delta_pts * DIFFICULTY_PER_PT else 0
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
    r = lcg(BOOTSTRAP_SEED)
    sums = []
    for _ in range(RESAMPLES):
        t = 0
        for _ in range(n):
            t += d[r() % n]
        sums.append(t)
    sums.sort()
    lo, hi = mean - Z95 * se, mean + Z95 * se
    b_lo, b_hi = sums[TAIL] / n, sums[RESAMPLES - TAIL - 1] / n  # 2.5th and 97.5th percentile of 1000 resamples
    gate = "ship" if lo > -NON_INFERIORITY else "block"  # non-inferiority: lower bound not below -2 points
    label = "better" if lo > 0 else "worse" if hi < 0 else "inconclusive"
    print(f"n={n:>4} change={'+' if delta_pts >= 0 else ''}{delta_pts} old={fmt(p1)}% new={fmt(p2)}% diff={fmt(mean)}")
    print(f"  normal CI {fmt(lo)}..{fmt(hi)}  bootstrap CI {fmt(b_lo)}..{fmt(b_hi)}  paired width {fmt(hi - lo)} vs unpaired {fmt(2 * Z95 * se_unpaired)}")
    print(f"  verdict: {label}, gate: {gate}")
    if not (lo <= mean <= hi and b_lo <= mean <= b_hi):
        raise SystemExit("mean outside its own interval")
    if not (hi - lo < 2 * Z95 * se_unpaired):
        raise SystemExit("pairing should narrow the interval")
    return hi - lo, gate


small = compare(SMALL_N, GAIN_PTS)
large = compare(LARGE_N, GAIN_PTS)
compare(LARGE_N, -GAIN_PTS)
compare(200, 0)
if not (large[0] < small[0]):
    raise SystemExit("more items must narrow the interval")
print(f"gate at n=100: {small[1]}, at n=1000: {large[1]}")
