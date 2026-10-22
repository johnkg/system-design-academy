# A paired comparison of two prompt versions with a bootstrap confidence interval and a CI gate, in Python:
# the same 400 test cases are graded for both versions, and the gate looks at the interval of the difference, not at the two pass rates alone.
import sys

SEED = 2026
HARDNESS_RANGE, BASE_PASS_BELOW, CAND_PASS_BELOW, NOISE = 1000, 700, 730, 100  # the candidate shifts each case by -100..+99
RESAMPLES = 1000
TAIL = RESAMPLES // 40  # bootstrap resamples, 2.5% of them in each tail
LABELED, JUDGE_ACCURACY, MIN_AGREE = 150, 88, 120  # the judge matches a human 88% of the time
REGRESSION_BUDGET = 200  # 2 points, in hundredths
seed = SEED


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def pp(h):
    """Hundredths of a percentage point as text, using integers only."""
    return f"{'-' if h < 0 else '+'}{abs(h) // 100}.{abs(h) % 100:02d}"


N = 400
HUNDREDTHS_PER_CASE = 10000 // N  # sum / N * 100 percent * 100 hundredths
base, cand = [], []
for _ in range(N):
    hardness = rnd(HARDNESS_RANGE)                                   # a hard case is hard for both versions
    base.append(1 if hardness < BASE_PASS_BELOW else 0)
    cand.append(1 if hardness + rnd(2 * NOISE) - NOISE < CAND_PASS_BELOW else 0)  # the new version is a little better on average
diff = [c - b for b, c in zip(base, cand)]                  # +1 fixed, -1 broken, 0 same
print(f"base {sum(base)}/{N}, candidate {sum(cand)}/{N}, fixed {diff.count(1)}, broken {diff.count(-1)}")


def interval(draw):
    """Bootstrap: resample the cases with replacement 1000 times and take the 2.5th and 97.5th percentile."""
    sums = []
    for _ in range(RESAMPLES):
        s = 0
        for _ in range(N):
            s += draw()
        sums.append(s)
    sums.sort()
    return sums[TAIL] * HUNDREDTHS_PER_CASE, sums[RESAMPLES - TAIL - 1] * HUNDREDTHS_PER_CASE


p_lo, p_hi = interval(lambda: diff[rnd(N)])                 # paired: one index, both versions
u_lo, u_hi = interval(lambda: cand[rnd(N)] - base[rnd(N)])  # unpaired: independent indexes
print(f"paired 95% interval for the change: {pp(p_lo)} to {pp(p_hi)} points")
print(f"unpaired interval would be:        {pp(u_lo)} to {pp(u_hi)} points")

# Judge calibration: compare the LLM judge with human labels on 150 cases.
agree = judge_pass = human_pass = 0
for i in range(LABELED):
    human = cand[i]
    judge = human if rnd(100) < JUDGE_ACCURACY else 1 - human
    agree += 1 if human == judge else 0
    judge_pass += judge
    human_pass += human
print(f"judge agrees with humans on {agree}/150, judge passes {judge_pass}, humans pass {human_pass}")

# Gate: block if the lower end of the interval is worse than a 2 point regression budget.
gate = "ship" if p_lo > -REGRESSION_BUDGET else "block"
proven = "improvement proven" if p_lo > 0 else "improvement not proven"
print(f"gate: {gate} ({proven})")
if not (p_hi - p_lo < u_hi - u_lo) or agree < MIN_AGREE or gate != "ship":
    sys.exit(1)
