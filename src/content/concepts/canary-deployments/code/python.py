# Canary analysis: compare the canary's error rate with the stable version's, using integers only.
# Error rates are counts out of 10000 requests. Everything is seeded, so the output never changes.
PER_MIN = 1000  # requests per minute across the whole service
STABLE = 100    # the stable version fails 1.00% of requests
RATE_SCALE = 10000  # rates are counts out of this many requests
PERCENT_TO_RATE = RATE_SCALE // 100
MIN_STABLE_RATE = 10  # 0.10%: the stable rate used is never below this
ZT_PER_SIGMA = 10  # zt is in tenths of a standard deviation
FINAL_STAGE = 50  # percent of traffic at the last canary stage
WIDER_STAGES = (25, FINAL_STAGE)
BASELINE_ERRORS, BASELINE_REQUESTS = 1000, 100000  # the 1.00% baseline of the gate demo
THREE_SIGMA = 3 * ZT_PER_SIGMA
MIN_SAMPLE = 300


def next_stages(share):
    return [s for s in WIDER_STAGES if s > share]  # after the first share the canary widens to 25%, then 50%


def make_rng(seed):  # 32-bit LCG; the middle bits are random enough for a demo
    state = [seed & 0xFFFFFFFF]

    def rnd():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return (state[0] >> 8) % RATE_SCALE

    return rnd


# The health gate. zt is the threshold in tenths of a standard deviation (30 = 3.0 sigma).
# Is the canary's error count higher than the stable rate predicts, by more than zt/10 standard deviations?
#   expected errors = cn * p / 10000, variance ~ expected, so:  x^2 >= (zt/10)^2 * variance * 10000^2
def gate(ce, cn, be, bn, zt, min_n):
    if cn == 0 or cn < min_n:
        return "hold"  # too little data to judge
    p = max(be * RATE_SCALE // bn, MIN_STABLE_RATE)  # stable rate, never below 0.10%
    x = ce * RATE_SCALE - cn * p  # errors above expectation, scaled by 10000
    return "rollback" if x > 0 and x * x >= zt * zt * cn * p * (RATE_SCALE // (ZT_PER_SIGMA * ZT_PER_SIGMA)) else "pass"


def rollout(name, share, bake, zt, min_n, canary_rate, seed):
    rnd = make_rng(seed)
    stages = [share] + next_stages(share)
    stage = in_stage = ce = cn = be = bn = failed = canary_failed = 0
    outcome = ""
    print(f"-- {name}: start {share}%, bake {bake} min, {zt // 10}.{zt % 10} sigma, min sample {min_n}")
    m = 0
    while outcome == "":
        m += 1
        for _ in range(PER_MIN):
            to_canary = rnd() < stages[stage] * PERCENT_TO_RATE
            err = rnd() < (canary_rate if to_canary else STABLE)
            if to_canary:
                cn += 1
                if err:
                    ce += 1
                    canary_failed += 1
            else:
                bn += 1
                if err:
                    be += 1
            if err:
                failed += 1
        in_stage += 1
        verdict = gate(ce, cn, be, bn, zt, min_n)
        action = "bake" if verdict == "pass" else verdict
        if verdict == "pass" and in_stage >= bake:
            action = "promote to 100%" if stage == len(stages) - 1 else "widen"
        print(f"m{m} {stages[stage]}% canary {ce}/{cn} stable {be}/{bn} -> {action}")
        if verdict == "rollback":
            outcome = "rolled back"
        elif action == "promote to 100%":
            outcome = "promoted"
        elif action == "widen":
            stage += 1
            in_stage = ce = cn = be = bn = 0
    truth = "buggy" if canary_rate > STABLE else "healthy"
    if outcome == "promoted":
        verdict = "MISSED BUG" if truth == "buggy" else "correct"
    else:
        verdict = "correct" if truth == "buggy" else "FALSE ALARM"
    print(f"result: {outcome}, v2 is {truth} ({verdict}); failed {failed}, by v2 {canary_failed}")
    if outcome == "promoted" and stages[stage] != FINAL_STAGE:
        raise SystemExit("promoted without passing the 50% stage")
    if canary_failed > failed:
        raise SystemExit("v2 cannot fail more requests than the whole service")


# The same gate on the same 1.00% baseline, judged on small and large canary samples.
for ce, cn in [(3, 100), (4, 100), (3, 300), (9, 300), (30, 1000)]:
    print(f"gate({ce}/{cn} vs 1.00%, 3 sigma) = {gate(ce, cn, BASELINE_ERRORS, BASELINE_REQUESTS, THREE_SIGMA, 0)}")
assert gate(0, 0, 1, 100, THREE_SIGMA, 0) == "hold", "no data must hold"
assert gate(5, 100, BASELINE_ERRORS, BASELINE_REQUESTS, THREE_SIGMA, MIN_SAMPLE) == "hold", "small sample must hold"

rollout("default gate, v2 buggy", share=5, bake=5, zt=THREE_SIGMA, min_n=MIN_SAMPLE, canary_rate=200, seed=8)
rollout("judge at once, v2 buggy", share=1, bake=2, zt=THREE_SIGMA, min_n=0, canary_rate=200, seed=12)
rollout("judge at once, v2 healthy", share=1, bake=2, zt=20, min_n=0, canary_rate=100, seed=7)
