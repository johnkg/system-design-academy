# Coverage and Mutation Testing: four test suites for one small discount function, measured two ways.
# Look for: line coverage says 100% for a suite that asserts nothing, while the mutation score (mutants killed) tells the truth.
# A "mutant" is the function with one small change (a > turned into >=, a + into -). A suite KILLS a mutant if some test fails on it.
# Mutant 6 is an equivalent mutant: it changes the code but not the behaviour, so no test can ever kill it.


def discount(total, member, coupon, m, hit):  # m = number of the mutant to switch on, 0 for the real code
    hit(1)
    rate = 0
    hit(2)
    if (total > 100) if m == 1 else (total >= 100):
        hit(3)
        rate = 0 if m == 2 else 10
    hit(4)
    if (not member) if m == 3 else member:
        hit(5)
        rate += -5 if m == 4 else 5
    hit(6)
    if coupon == 'SAVE5':
        hit(7)
        rate += 6 if m == 5 else 5
    elif coupon == 'SAVE10':
        hit(8)
        rate += 9 if m == 10 else 10
    hit(9)
    if (rate >= 20) if m == 6 else (rate > 20):
        hit(10)
        rate = 25 if m == 7 else 20
    hit(11)
    off = -((-total * rate) // 100) if m == 8 else (total * rate) // 100  # ceil or floor
    hit(12)
    return total + off if m == 9 else total - off


LINES = 12
MUTANTS = [  # (what changed, operator family)
    ('>= turned into >', 'condition'), ('base rate 10 turned into 0', 'constant'), ('member test negated', 'condition'),
    ('member bonus + turned into -', 'arithmetic'), ('SAVE5 bonus 5 turned into 6', 'constant'), ('cap > turned into >=', 'condition'),
    ('cap value 20 turned into 25', 'constant'), ('floor turned into ceil', 'arithmetic'), ('minus turned into plus', 'arithmetic'),
    ('SAVE10 bonus 10 turned into 9', 'constant'),
]


def seeded(seed):  # MINSTD generator: the same integers in every language
    state = [seed]

    def rand(n):
        state[0] = (state[0] * 48271) % 2147483647
        return state[0] % n
    return rand


def reference(total, member, coupon):  # an independent way to compute the answer, for the generated suite
    pct = (10 if total >= 100 else 0) + (5 if member else 0) + (5 if coupon == 'SAVE5' else 10 if coupon == 'SAVE10' else 0)
    if pct > 20:
        pct = 20
    return total - (total * pct) // 100


# a test is (total, member, coupon, expected); expected None means the test calls the code and asserts nothing
SMOKE = [(150, True, 'SAVE10', None), (50, False, '', None), (100, False, 'SAVE5', None)]
HAPPY = [(150, True, 'SAVE10', 120), (50, False, '', 50), (100, False, 'SAVE5', 85)]
EDGES = [(100, False, '', 90), (99, False, '', 99), (101, False, '', 91), (200, True, 'SAVE10', 160), (100, True, 'SAVE5', 80), (50, True, '', 48), (120, False, 'SAVE10', 96)]
gen = seeded(5)
COUPONS = ['', 'SAVE5', 'SAVE10']
GENERATED = []
for _ in range(60):
    t = 95 + gen(11)
    mem = gen(2) == 1
    c = COUPONS[gen(3)]
    GENERATED.append((t, mem, c, reference(t, mem, c)))
SUITES = [('Smoke: runs the code, asserts nothing', SMOKE), ('Happy path: one assertion each', HAPPY), ('Edges and combinations', EDGES), ('60 generated inputs against a reference', GENERATED)]


def passes(tests, m):
    return all(want is None or discount(t, mem, c, m, lambda _l: None) == want for t, mem, c, want in tests)


def coverage(tests):
    seen = set()
    for t, mem, c, _ in tests:
        discount(t, mem, c, 0, seen.add)
    return len(seen)


for name, tests in SUITES:
    asserts = len([t for t in tests if t[3] is not None])
    lines = coverage(tests)
    killed = [not passes(tests, i + 1) for i in range(len(MUTANTS))]
    k = len([x for x in killed if x])
    print(f"{name}: {len(tests)} tests, {asserts} assertions, passes {str(passes(tests, 0)).lower()}")
    print(f"  line coverage {lines}/{LINES} = {100 * lines // LINES}%, mutants killed {k}/{len(MUTANTS)} = {100 * k // len(MUTANTS)}%, mutation run cost {len(tests) * (len(MUTANTS) + 1)}")
    survivors = '; '.join(MUTANTS[i][0] for i in range(len(MUTANTS)) if not killed[i]) or 'none'
    print(f"  survivors: {survivors}")
