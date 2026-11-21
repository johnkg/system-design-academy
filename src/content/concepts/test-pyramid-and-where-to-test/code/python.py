# Test Pyramid and Where to Test: one app with 8 known bugs, tested by suites with a different mix of test kinds.
# Look for: which bugs each mix catches, what it costs to run, and how often a run goes red for no reason.
# Model: tests of one kind are ordered by value, so the n-th test of a kind reaches the n-th area it can see.
# need = [unit, integration, e2e]: how many tests of that kind are needed to reach the bug (0 = that kind cannot see it).
KINDS = ['unit', 'integration', 'e2e']
COST = [1, 20, 150]   # assumed cost units to run one test of each kind
FLAKE = [0, 10, 50]   # assumed chance in 1000 that one test fails on its own in one run
RUNS = 50
BUGS = [
    ('Percentage discount rounds down', [1, 3, 8]),
    ('Tax wrong at the exact threshold', [2, 5, 0]),
    ('Coupons stack in the wrong order', [3, 6, 10]),
    ('Order saved with swapped columns', [0, 1, 4]),
    ('API sends cents where dollars expected', [0, 2, 5]),
    ('Payment timeout set too short', [0, 3, 0]),
    ('Pay button wired to the wrong handler', [0, 0, 1]),
    ('Session lost after login redirect', [0, 0, 2]),
]
SUITES = [
    ('Pyramid', [60, 12, 3]),
    ('Trophy', [20, 30, 5]),
    ('Ice-cream cone', [5, 5, 60]),
    ('Unit tests only', [200, 0, 0]),
    ('End-to-end only', [0, 0, 60]),
]


def seeded(seed):  # MINSTD generator: the same integers in every language
    state = [seed]

    def rand(n):
        state[0] = (state[0] * 48271) % 2147483647
        return state[0] % n
    return rand


def evaluate(counts):
    found = []
    for _, need in BUGS:
        hit = -1
        for i in range(3):
            if need[i] > 0 and counts[i] >= need[i]:
                hit = i
                break
        found.append(hit)
    cost = sum(counts[i] * COST[i] for i in range(3))
    rand = seeded(42)
    red = 0
    for _ in range(RUNS):
        flaked = False
        for i in range(3):
            for _t in range(counts[i]):
                if rand(1000) < FLAKE[i]:
                    flaked = True
        if flaked:
            red += 1
    return found, cost, red


for name, counts in SUITES:
    found, cost, red = evaluate(counts)
    caught = len([f for f in found if f >= 0])
    print(f"{name} ({'/'.join(str(c) for c in counts)}): caught {caught}/{len(BUGS)}, cost {cost}, red runs {red}/{RUNS}")
    missed = [BUGS[i][0] for i in range(len(BUGS)) if found[i] < 0]
    print(f"  escaped: {'; '.join(missed) if missed else 'none'}")
pyramid_found, _, _ = evaluate(SUITES[0][1])
for i, (n, _) in enumerate(BUGS):
    print(f'Pyramid found "{n}" via {KINDS[pyramid_found[i]]} tests')
