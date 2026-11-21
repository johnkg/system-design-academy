# A mobile release over 30 days for 1,000,000 active users. Version 7 goes out through a staged store rollout (1%, 5%, 20%,
# 50%, 100%) and may carry a bug. The run shows how fast the bug is found, how it is stopped, who is left on it and who is
# locked out. Day 0 is a Thursday. All numbers are integers; the only randomness is the seeded generator below, which the
# automatic gate uses to sample users, so the output never changes.
DAYS = 30
USERS = 1000000
OLD_MIX = [600000, 220000, 180000]  # users on v6, v5, and v4 or older on the day v7 ships
STUCK_PCT = 13     # 8% never update and 5% have a phone too old for the update: they stay where they are
ORGANIC_PCT = 15   # of the willing users the store offers the update to, this share installs it each day
HOTFIX_PCT = 25    # of the users on the broken build, this share installs the fix each day
STICKY_PCT = 3     # users on the broken build who never take the fix (they have switched updates off)
FORCED_PCT = 70    # of the willing users behind a forced-upgrade screen, this share updates each day
FLOOR_DAY = 14     # the day the minimum supported version is raised
FIX_DAYS = 1       # a day to fix, build and test before the hotfix is submitted to the store
HALT_DAYS = 3      # how long a false alarm freezes the rollout while people look
BASE_PM = 5        # 5 in 1,000 users crash on an ordinary day, on any healthy version
MARGIN_PM = 3      # the gate halts when the new version is worse than the old one by more than this
TICKETS = 3000     # with no monitoring, support tickets and store reviews notice at this many hurt users
TICKET_LAG = 3     # days from that moment until a fix or a switch-off is under way
REVIEW_MIN = 5000  # a person does not act on fewer users than this on the new version
SEED = 20261120


def stage_at(u):  # store share on the u-th unfrozen day
    return 1 if u < 2 else 5 if u < 4 else 20 if u < 7 else 50 if u < 10 else 100


def weekday(d):  # day 0 is a Thursday
    return (d + 3) % 7 < 5


def run(name, bug, bug_pm, monitor, sample, kill, delay, floor):
    rng = SEED

    def rand():  # Park-Miller: the same numbers in every language
        nonlocal rng
        rng = (rng * 48271) % 2147483647
        return rng

    W = [c * (100 - STUCK_PCT) // 100 for c in OLD_MIX]  # willing to update, by old version
    S = [c - W[i] for i, c in enumerate(OLD_MIX)]        # stuck where they are
    U = sum(W)
    blocked = [2] if floor == "v5" else [1, 2] if floor == "v6" else [0, 1, 2] if floor == "v7" else []
    flag_route = bug == "flag" and kill == "flag"
    n_v7 = n_fix = adopted = hits = aff = bug_days = locked_stuck = sticky = 0
    stage = unfrozen = full = 0
    full = -1
    F = H = -1
    freeze_until = false_halts = 0
    suffer, end_new, end_aff = [], [], []
    for d in range(DAYS):
        if flag_route and F >= 0 and d >= F:
            aff = 0  # the flag is off: nobody hits the bug any more
        if monitor == "review" and F < 0 and bug != "none" and weekday(d) and d > 0:
            # a person reads yesterday's dashboard: enough users, and a crash rate at least double the old one
            if end_new[d - 1] >= REVIEW_MIN and 1000 * end_aff[d - 1] >= BASE_PM * end_new[d - 1]:
                F = d + 1
        if F >= 0 and not flag_route and H < 0:
            H = F + FIX_DAYS + delay  # the hotfix day, after store review
        halted = d < freeze_until or (F >= 0 and not flag_route and d >= F and d < H)
        if d == H:
            sticky = n_v7 * STICKY_PCT // 100
        if H >= 0 and d >= H:
            mig = (n_v7 - sticky) * HOTFIX_PCT // 100
            if n_v7 > 0:
                aff = aff * (n_v7 - mig) // n_v7
            n_v7 -= mig
            n_fix += mig
        if H >= 0 and d >= H:
            stage = 100  # the hotfix goes to everyone at once
        elif not halted:
            stage = stage_at(unfrozen)
            unfrozen += 1
        if stage == 100 and full < 0:
            full = d

        def adopt(x):
            nonlocal adopted, n_v7, n_fix, hits, aff
            if x <= 0:
                return
            adopted += x
            if H >= 0 and d >= H:
                n_fix += x
                return
            n_v7 += x
            if bug != "none" and not (flag_route and F >= 0 and d >= F):
                a = x * bug_pm // 1000
                hits += a
                aff += a

        if d == FLOOR_DAY:
            for b in blocked:
                locked_stuck += S[b]
                S[b] = 0
        if d >= FLOOR_DAY and not halted and stage == 100:
            for b in blocked:
                m = W[b] * FORCED_PCT // 100
                W[b] -= m
                adopt(m)
        if not halted:
            sum_w = sum(W)
            want = min(sum_w, (U * stage // 100 - adopted) * ORGANIC_PCT // 100)
            if want > 0:
                take = [want * w // sum_w for w in W]
                given = sum(take)
                for b in range(3):
                    if given < want:
                        e = min(W[b] - take[b], want - given)
                        take[b] += e
                        given += e
                for b in range(3):
                    W[b] -= take[b]
                adopt(want)
        suffer.append(aff)
        end_new.append(n_v7 + n_fix)
        end_aff.append(aff)
        bug_days += aff
        if F < 0 and bug != "none" and monitor == "none" and hits >= TICKETS:
            F = d + TICKET_LAG
        if F < 0 and monitor == "gate" and n_v7 + n_fix >= sample and d >= freeze_until:
            # the gate samples this many users of the new version and compares their crash rate with the old version's
            pm = BASE_PM * 1000 + aff * 1000000 // (n_v7 + n_fix)  # crashes per million users
            c = 0
            for _ in range(sample):
                if rand() % 1000000 < pm:
                    c += 1
            if c * 1000 > sample * (BASE_PM + MARGIN_PM):
                if aff > 0:
                    F = d + 1  # a real bug: stop and fix
                else:
                    freeze_until = d + 1 + HALT_DAYS  # noise: the rollout stops for a few days for nothing
                    false_halts += 1
    peak, contained = 0, -1  # contained: the first day fewer than a tenth of the peak number of users are still being hit
    for d, s in enumerate(suffer):
        if s > peak:
            peak, contained = s, -1
        elif contained < 0 and s * 10 < peak:
            contained = d
    live_bug = bug != "none" and not (flag_route and F >= 0)
    locked = locked_stuck + sum(W[b] for b in blocked)
    old = [(0 if i in blocked else w) + S[i] for i, w in enumerate(W)]
    if n_v7 + n_fix + old[0] + old[1] + old[2] + locked != USERS:
        raise Exception("users lost")
    print(f"-- {name}")
    verdict = "no bug" if bug == "none" else "not contained in 30 days" if contained < 0 else f"contained on day {contained}"
    print(f"  bug: {hits} users hit it, {bug_days} user-days with it, {verdict}")
    print(f"  rollout: store at 100% on day {'never' if full < 0 else full}, {false_halts} false halts, {n_v7 if live_bug else 0} users still on the broken version")
    print(f"  mix: v7 {n_v7}, v7.1 {n_fix}, v6 {old[0]}, v5 {old[1]}, v4 or older {old[2]}, locked out {locked}")


base = dict(bug="crash", bug_pm=30, monitor="none", sample=2000, kill="build", delay=3, floor="none")
run("3% crash, no monitoring, new build only", **base)
run("3% crash, daily review", **{**base, "monitor": "review"})
run("3% crash, automatic gate on 2000 users", **{**base, "monitor": "gate"})
run("3% crash, automatic gate on 20000 users", **{**base, "monitor": "gate", "sample": 20000})
run("3% crash, gate, 7 days of store review for the hotfix", **{**base, "monitor": "gate", "delay": 7})
run("bug behind a flag, gate, server flag", **{**base, "bug": "flag", "monitor": "gate", "kill": "flag"})
run("crash in the build, gate, server flag", **{**base, "monitor": "gate", "kill": "flag"})
run("healthy release, gate on 200 users", **{**base, "bug": "none", "monitor": "gate", "sample": 200})
run("healthy release, gate on 20000 users", **{**base, "bug": "none", "monitor": "gate", "sample": 20000})
run("3% crash, gate, minimum version v7 on day 14", **{**base, "monitor": "gate", "floor": "v7"})
run("3% crash, gate, minimum version v5 on day 14", **{**base, "monitor": "gate", "floor": "v5"})
