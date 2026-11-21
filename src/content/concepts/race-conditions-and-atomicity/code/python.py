# Race conditions: a tiny deterministic scheduler runs EVERY interleaving of the threads' steps (no real threads, no clock).
# A step is one indivisible action; between two steps any other runnable thread may go first.
# Look for: the unsafe counter loses updates in most schedules; locking each step separately looks safe but is not;
# a lock, an atomic add and a compare-and-swap loop are correct in every schedule.
LIMIT = 80

# R read into a private copy, W write copy+1, A atomic add, L lock, U unlock, C compare-and-swap then retry on failure,
# K check the private copy (stop if too small), S subtract, D atomic check-and-subtract, X compare-and-swap subtract.
PROGRAMS = {
    'counter': {
        'unsafe': ['R', 'W'],
        'lock': ['L', 'R', 'W', 'U'],
        'lockEach': ['L', 'R', 'U', 'L', 'W', 'U'],
        'atomic': ['A'],
        'cas': ['R', 'C'],
    },
    'withdraw': {
        'unsafe': ['R', 'K', 'S'],
        'lock': ['L', 'R', 'K', 'S', 'U'],
        'lockEach': ['L', 'R', 'U', 'K', 'L', 'S', 'U'],
        'atomic': ['D'],
        'cas': ['R', 'K', 'X'],
    },
}


def program(scenario, variant, iters):
    return PROGRAMS[scenario][variant] * iters


def runnable(st, prog, i):
    if st['pc'][i] >= len(prog):
        return False
    return not (prog[st['pc'][i]] == 'L' and st['owner'] != -1)


# Executes one step of thread i and returns the new state (the old one is left alone).
def step(st, prog, i):
    s = {'shared': st['shared'], 'owner': st['owner'], 'pc': st['pc'][:], 'tmp': st['tmp'][:]}
    op = prog[s['pc'][i]]
    s['pc'][i] += 1
    if op == 'R':
        s['tmp'][i] = s['shared']
    elif op == 'W':
        s['shared'] = s['tmp'][i] + 1
    elif op == 'A':
        s['shared'] += 1
    elif op == 'S':
        s['shared'] -= LIMIT
    elif op == 'D':
        if s['shared'] >= LIMIT:
            s['shared'] -= LIMIT
    elif op == 'L':
        s['owner'] = i
    elif op == 'U':
        s['owner'] = -1
    elif op == 'K':
        if s['tmp'][i] < LIMIT:
            if s['owner'] == i:
                s['owner'] = -1
            s['pc'][i] = len(prog)
    elif op == 'C':
        if s['shared'] == s['tmp'][i]:
            s['shared'] = s['tmp'][i] + 1
        else:
            s['pc'][i] -= 2
    elif op == 'X':
        if s['shared'] == s['tmp'][i]:
            s['shared'] -= LIMIT
        else:
            s['pc'][i] -= 3
    return s


# Depth-first walk over every schedule. Returns how many there were and how many ended with a wrong value.
def explore(scenario, variant, threads, iters):
    prog = program(scenario, variant, iters)
    expected = threads * iters if scenario == 'counter' else 20
    start = {'shared': 0 if scenario == 'counter' else 100, 'owner': -1, 'pc': [0] * threads, 'tmp': [0] * threads}
    r = {'total': 0, 'wrong': 0, 'deadlocks': 0, 'example': '-', 'lowest': 1000000}
    trail = []

    def walk(st):
        ready = [i for i in range(threads) if runnable(st, prog, i)]
        if not ready:
            done = all(st['pc'][i] >= len(prog) for i in range(threads))
            if not done:
                r['deadlocks'] += 1
                return
            r['total'] += 1
            if st['shared'] < r['lowest']:
                r['lowest'] = st['shared']
            if st['shared'] != expected:
                r['wrong'] += 1
                if r['example'] == '-':
                    r['example'] = ''.join(str(t) for t in trail)
            return
        for i in ready:
            trail.append(i)
            walk(step(st, prog, i))
            trail.pop()

    walk(start)
    return r


cases = [('counter', 2, 1), ('counter', 2, 2), ('counter', 3, 1), ('withdraw', 2, 1)]
for scenario, threads, iters in cases:
    if scenario == 'counter':
        what = f'{threads} threads x {iters} increments, expected {threads * iters}'
    else:
        what = f'{threads} threads each withdraw 80 from 100, expected 20 left'
    print(f'== {scenario}: {what}')
    for variant in ['unsafe', 'lock', 'lockEach', 'atomic', 'cas']:
        r = explore(scenario, variant, threads, iters)
        print(f"{variant:<9} interleavings={r['total']:<6} wrong={r['wrong']:<6} lowest={r['lowest']:<5} first bad schedule={r['example']}")
