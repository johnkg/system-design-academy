# A progressive rollout in Python: regions go one after another (waves), each wave grows the new version in stages,
# and every stage compares the new version's error rate with the old version's, running side by side, using a one-sided z-test.
import math
import sys

STAGES = [1, 10, 50]  # percent of a region's traffic on the new version; after the last stage the region is promoted to 100%
REGIONS = [("sa", 20000), ("eu", 60000), ("us", 120000)]
MIN_CANARY = 300      # fewer requests than this prove nothing, so the bake time is extended
Z_LIMIT = 2.33        # one-sided, about a 1% chance of a false alarm per check
TOTAL = sum(requests for _, requests in REGIONS)

SEED = 7
MAX_EXPOSED_SHARE = 50  # a bad release may reach at most 1/50 (2%) of all requests
seed = SEED


def chance(per_10000):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % 10000 < per_10000


def errors(n, rate):
    return sum(1 for _ in range(n) if chance(rate))


def fmt2(h):
    # Prints hundredths as text, such as -118 -> -1.18, so every language shows the same digits.
    sign = "-" if h < 0 else ""
    return f"{sign}{abs(h) // 100}.{abs(h) % 100:02d}"


def z_score(ec, nc, eb, nb):
    # z statistic with a pooled error rate: how many standard errors the canary is above the baseline
    p = (ec + eb) / (nc + nb)
    se = math.sqrt(p * (1 - p) * (1 / nc + 1 / nb))
    return 0 if se == 0 else (ec / nc - eb / nb) / se


def rollout(name, canary_rate):
    base_rate = 100  # the old version fails 1% of requests (rates are per 10,000)
    exposed = steps = 0
    print(f"release {name} (real error rate {canary_rate / 100:g}%)")
    for region, requests in REGIONS:
        for pct in STAGES:
            nc = requests * pct // 100
            mult = 1
            while nc * mult < MIN_CANARY:  # wait longer until there is enough traffic
                mult *= 2
            nc *= mult
            nb = requests * mult - nc
            ec = errors(nc, canary_rate)
            eb = errors(nb, base_rate)
            z = z_score(ec, nc, eb, nb)
            bad = z > Z_LIMIT
            exposed += nc
            steps += 1
            print(f"  {region} {pct}%: {nc} canary requests, {ec} errors, z={fmt2(math.floor(z * 100))} -> {'ROLL BACK' if bad else 'ok'}")
            if bad:
                return False, exposed, steps
    return True, exposed, steps


good_done, _, _ = rollout("v2", 100)
bad_done, bad_exposed, bad_steps = rollout("v3", 200)
share = bad_exposed * 100 / TOTAL
print(f"v2 finished: {str(good_done).lower()}, v3 finished: {str(bad_done).lower()}")
print(f"v3 was seen by {bad_exposed} of {TOTAL} requests ({fmt2(math.floor(share * 100))}%) before the rollback, {bad_steps} checks")
if not good_done or bad_done or bad_exposed > TOTAL / MAX_EXPOSED_SHARE or bad_steps != 2:
    sys.exit(1)
