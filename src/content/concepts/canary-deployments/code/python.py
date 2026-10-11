# Canary analysis: compare the canary's error rate with the stable version's, using integers only.
# Error rates are counts out of 10000 requests. Everything is seeded, so the output never changes.
PER_MIN = 1000  # requests per minute across the whole service
STABLE = 100    # the stable version fails 1.00% of requests


def next_stages(share):
    return [s for s in (25, 50) if s > share]  # after the first share the canary widens to 25%, then 50%


def make_rng(seed):  # 32-bit LCG; the middle bits are random enough for a demo
    state = [seed & 0xFFFFFFFF]

    def rnd():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return (state[0] >> 8) % 10000

    return rnd


# The health gate. zt is the threshold in tenths of a standard deviation (30 = 3.0 sigma).
# Is the canary's error count higher than the stable rate predicts, by more than zt/10 standard deviations?
#   expected errors = cn * p / 10000, variance ~ expected, so:  x^2 >= (zt/10)^2 * variance * 10000^2
def gate(ce, cn, be, bn, zt, min_n):
    if cn == 0 or cn < min_n:
        return "hold"  # too little data to judge
    p = max(be * 10000 // bn, 10)  # stable rate, never below 0.10%
    x = ce * 10000 - cn * p  # errors above expectation, scaled by 10000
    return "rollback" if x > 0 and x * x >= zt * zt * cn * p * 100 else "pass"


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
            to_canary = rnd() < stages[stage] * 100
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
    if outcome == "promoted" and stages[stage] != 50:
        raise SystemExit("promoted without passing the 50% stage")
    if canary_failed > failed:
        raise SystemExit("v2 cannot fail more requests than the whole service")


# The same gate on the same 1.00% baseline, judged on small and large canary samples.
for ce, cn in [(3, 100), (4, 100), (3, 300), (9, 300), (30, 1000)]:
    print(f"gate({ce}/{cn} vs 1.00%, 3 sigma) = {gate(ce, cn, 1000, 100000, 30, 0)}")
assert gate(0, 0, 1, 100, 30, 0) == "hold", "no data must hold"
assert gate(5, 100, 1000, 100000, 30, 300) == "hold", "small sample must hold"

rollout("default gate, v2 buggy", 5, 5, 30, 300, 200, 8)
rollout("judge at once, v2 buggy", 1, 2, 30, 0, 200, 12)
rollout("judge at once, v2 healthy", 1, 2, 20, 0, 100, 7)
