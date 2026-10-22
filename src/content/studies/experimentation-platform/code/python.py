# An experimentation core in Python: hash bucketing, ramp-ups, layers, a sample-ratio check and a significance test with peeking.
# All maths on counts is exact; the draws come from a seeded integer generator, so every run prints the same numbers.
import math

MASK = 0xFFFFFFFF
BUCKETS = 10000  # buckets 0..9999; rates in basis points
HALF, BUCKETS_PER_PERCENT = BUCKETS // 2, BUCKETS // 100
SEED, USER_COUNT = 7, 40000
LAYER_TOLERANCE = 0.02  # overlap of independent layers may drift this far from the expected share
CONTROL_RATE, TREATMENT_RATE = 1000, 1150  # conversion in basis points: 10.00% and 11.50%
CHI2_LIMIT = 3.841  # chi-square (1 degree of freedom) at the 5% level
Z_SUM, BASE_RATE, LIFT, DAILY_USERS = 2.8, 0.1, 0.01, 2000  # 1.96 + 0.84 for 5% significance and 80% power
AA_TESTS, LOOKS, LOOK_SIZE = 400, 20, 100
Z95_SQUARED, WIDE_Z_SQUARED = 3.8416, 9.61  # 1.96 squared, and 3.1 squared


def fnv1a(text):
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & MASK
    return h


def bucket(salt, user):
    # A salt plus the user id gives a number in 0..9999. The finalizer mixes the bits so the low digits are even.
    h = fnv1a(f"{salt}:{user}")
    h = ((h ^ (h >> 15)) * 2246822519) & MASK
    return (h ^ (h >> 13)) % BUCKETS


def assign(exp, user):
    # layer: experiments in one layer own separate slices of 0..9999, so a user is in at most one of them.
    if not exp["slice"][0] <= bucket("layer-" + exp["layer"], user) < exp["slice"][1]:
        return None
    if bucket(exp["salt"] + ":ramp", user) >= exp["ramp"]:      # not ramped in yet
        return None
    return "treatment" if bucket(exp["salt"] + ":arm", user) < HALF else "control"  # the arm does not depend on the ramp


seed = SEED


def draw():  # 0..9999
    global seed
    seed = (seed * 1664525 + 1013904223) & MASK
    return (seed >> 16) % BUCKETS


def z_squared(n1, c1, n2, c2):
    # Two-proportion z test as z squared (no square root needed).
    p, d = (c1 + c2) / (n1 + n2), c1 / n1 - c2 / n2
    return (d * d) / (p * (1 - p) * (1 / n1 + 1 / n2))


def srm_chi(a, b):
    return ((a - b) * (a - b)) / (a + b)


def milli(x):  # 3 decimals, formatted by hand so every language prints the same
    m = math.floor(x * 1000 + 0.5)
    return f"{m // 1000}.{m % 1000:03d}"


users = [f"u{i + 1}" for i in range(USER_COUNT)]
exp_a = {"salt": "exp-a", "layer": "checkout", "slice": (0, HALF), "ramp": 100}
exp_b = {"salt": "exp-b", "layer": "checkout", "slice": (HALF, BUCKETS), "ramp": BUCKETS}
exp_c = {"salt": "exp-c", "layer": "search", "slice": (0, HALF), "ramp": BUCKETS}
full_a = {**exp_a, "ramp": BUCKETS}
print(f"u1 buckets: arm {bucket('exp-a:arm', 'u1')}, ramp {bucket('exp-a:ramp', 'u1')}, layer {bucket('layer-checkout', 'u1')}")

# 1. Ramp-up: everyone in at 1% stays in at 5% and 25%, with the same arm.
previous = {}
for ramp in (100, 500, 2500, 10000):
    now = {u: a for u in users if (a := assign({**exp_a, "ramp": ramp}, u))}
    kept = all(now.get(u) == a for u, a in previous.items())
    print(f"ramp {ramp // BUCKETS_PER_PERCENT}%: {len(now)} users, earlier users kept their arm: {str(kept).lower()}")
    assert kept
    previous = now

# 2. Layers: A and B share a layer, so they never overlap. C is in another layer and overlaps both independently.
rows = [(assign(full_a, u), assign(exp_b, u), assign(exp_c, u)) for u in users]
in_a, in_b, in_c = (sum(bool(r[i]) for r in rows) for i in range(3))
both, in_ac = sum(bool(r[0] and r[1]) for r in rows), sum(bool(r[0] and r[2]) for r in rows)
print(f"layer checkout: A {in_a}, B {in_b}, in both {both}; in A and C {in_ac} of {in_a} (C has {in_c} of {len(users)})")
assert both == 0 and abs(in_ac / in_a - in_c / len(users)) <= LAYER_TOLERANCE

# 3. Outcomes for experiment A at full ramp: control converts at 10.00%, treatment at 11.50%.
n, c = [0, 0], [0, 0]
for u in users:
    a = assign(full_a, u)
    if a:
        k = 1 if a == "treatment" else 0
        n[k] += 1
        c[k] += draw() < (TREATMENT_RATE if k else CONTROL_RATE)
chi, z2 = srm_chi(n[0], n[1]), z_squared(n[0], c[0], n[1], c[1])
print(f"control {c[0]}/{n[0]}, treatment {c[1]}/{n[1]}; sample-ratio chi2 {milli(chi)} (limit 3.841), z2 {milli(z2)} (limit 3.841)")
assert chi <= CHI2_LIMIT and z2 >= CHI2_LIMIT

# 4. Sample size per arm for a 1 point lift on a 10% rate: 2 * (1.96 + 0.84)^2 * p(1-p) / delta^2, and the days it takes at 2,000 enrolled users a day.
per_arm = math.ceil((2 * Z_SUM * Z_SUM * BASE_RATE * (1 - BASE_RATE)) / (LIFT * LIFT))
print(f"needs {per_arm} users per arm, which is {-(-2 * per_arm // DAILY_USERS)} days at 2000 users a day")

# 5. Peeking: 400 A/A tests (no real difference), 20 looks of 100 users per arm. Stop at the first look past the limit.
fixed_hits = peek_hits = bound_hits = 0
for _ in range(AA_TESTS):
    ca = cb = 0
    early = bound = False
    for look in range(1, LOOKS + 1):
        for _ in range(LOOK_SIZE):
            ca += draw() < CONTROL_RATE
            cb += draw() < CONTROL_RATE
        last = z_squared(look * LOOK_SIZE, ca, look * LOOK_SIZE, cb) if ca + cb > 0 else 0.0
        early = early or last > Z95_SQUARED   # any look past 1.96
        bound = bound or last > WIDE_Z_SQUARED     # any look past 3.1, a wider limit that pays for 20 looks
    fixed_hits += last > Z95_SQUARED
    peek_hits += early
    bound_hits += bound
print(f"false wins in 400 A/A tests: one look at the end {fixed_hits}, stopping at any of 20 looks {peek_hits}, with the wider limit {bound_hits}")
assert peek_hits > fixed_hits * 2 and bound_hits < peek_hits
