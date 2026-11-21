# Flaky Tests: a 32-test suite run 200 times with a seeded generator, under four ways of dealing with flakiness.
# Look for: how many red builds are false alarms, and how many times the one REAL intermittent bug was hidden by a retry or a quarantine.
# Five suspicious tests: "reader" fails if a "writer" test left shared state just before it (order), "clock" fails near a
# minute boundary, two "sleep" tests wait a fixed time for a job that takes a variable time, and "race" is a genuine bug
# in the code under test that shows up on about 1 attempt in 20. From the outside they all look the same: they fail now and then.
TESTS, RUNS, WAIT = 32, 200, 18  # WAIT: ticks a fixed sleep waits; a job takes 1 to 20 ticks
POLICIES = [
    ('No retries, nothing fixed', 0, False, (False, False, False)),
    ('Retry up to 2 times', 2, False, (False, False, False)),
    ('Quarantine the flaky tests', 0, True, (False, False, False)),
    ('Fix the causes, no retries', 0, False, (True, True, True)),
]


def seeded(seed):  # MINSTD generator: the same integers in every language
    state = [seed]

    def rand(n):
        state[0] = (state[0] * 48271) % 2147483647
        return state[0] % n
    return rand


def simulate(retries, quarantine, fix):
    rand, again = seeded(7), seeded(99)  # `again` supplies the draws for retries, so the first attempts match across policies
    fix_state, fix_clock, fix_poll = fix
    red = false_alarm = showed = reported = cost = 0
    for _ in range(RUNS):
        w = rand(TESTS)
        rd0 = rand(TESTS - 1)
        rd = rd0 + 1 if rd0 >= w else rd0
        jobs = [1 + rand(20), 1 + rand(20)]
        # first attempt of each test; the draws happen whatever the policy, so policies see the same runs
        order = (not fix_state) and rd > w and rd - w <= 3
        tick = rand(60)
        clock = (not fix_clock) and tick >= 58
        sleep = [(not fix_poll) and d > WAIT for d in jobs]
        race = rand(20) == 0
        cost += TESTS + sum(d if fix_poll else WAIT for d in jobs)
        if race:
            showed += 1
        for _attempt in range(retries):  # only failing tests are run again
            if order:
                order = False  # run alone, the state it tripped on is gone
                cost += 1
            if clock:
                clock = (not fix_clock) and again(60) >= 58
                cost += 1
            for i in range(2):
                if sleep[i]:
                    d = 1 + again(20)
                    sleep[i] = d > WAIT
                    cost += 1 + WAIT
            if race:
                race = again(20) == 0
                cost += 1
        if quarantine:
            order = clock = race = False
            sleep = [False, False]
        failed = order or clock or sleep[0] or sleep[1] or race
        if failed:
            red += 1
            if not race:
                false_alarm += 1
        if race:
            reported += 1
    return red, false_alarm, showed, reported, showed - reported, cost


for name, retries, quarantine, fix in POLICIES:
    red, fa, showed, reported, hidden, cost = simulate(retries, quarantine, fix)
    print(f"{name}: red {red}/{RUNS}, false alarms {fa}, real bug showed {showed}, reported {reported}, hidden {hidden}, cost {cost}")
