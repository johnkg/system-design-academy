# Locks: a deterministic scheduler (no real threads, no clock) for two questions.
# Part 1 walks EVERY interleaving of threads that take locks in some order and counts the schedules that end in deadlock.
# Part 2 is a tick model of contention: threads alternate work outside a lock and a critical section behind a lock.
# Look for: opposite lock order deadlocks in some schedules, the same order never does; one coarse lock is safe
# but, once the lock is busy all the time, more threads stop helping.
NAMES = 'ABCG'

# "L0" take lock 0 (A), "U0" release it, "W" do the work. The locks are not re-entrant: taking a lock you hold blocks you.
SCENARIOS = {
    'opposite': [['L0', 'L1', 'W', 'U1', 'U0'], ['L1', 'L0', 'W', 'U0', 'U1']],
    'ordered': [['L0', 'L1', 'W', 'U1', 'U0'], ['L0', 'L1', 'W', 'U1', 'U0']],
    'ring': [['L0', 'L1', 'W', 'U1', 'U0'], ['L1', 'L2', 'W', 'U2', 'U1'], ['L2', 'L0', 'W', 'U0', 'U2']],
    'ringOrdered': [['L0', 'L1', 'W', 'U1', 'U0'], ['L1', 'L2', 'W', 'U2', 'U1'], ['L0', 'L2', 'W', 'U2', 'U0']],
    'reentry': [['L0', 'L0', 'W', 'U0', 'U0'], ['L0', 'L0', 'W', 'U0', 'U0']],
    'coarse': [['L3', 'W', 'U3'], ['L3', 'W', 'U3']],
}


def explore(progs):
    n = len(progs)
    r = {'complete': 0, 'deadlocked': 0, 'example': '-', 'stuck': '-'}
    trail = []

    def can_run(st, i):
        pc = st['pc'][i]
        if pc >= len(progs[i]):
            return False
        op = progs[i][pc]
        return not (op[0] == 'L' and st['owner'][int(op[1:])] != -1)

    def walk(st):
        ready = [i for i in range(n) if can_run(st, i)]
        if not ready:
            unfinished = [i for i in range(n) if st['pc'][i] < len(progs[i])]
            if not unfinished:
                r['complete'] += 1
                return
            r['deadlocked'] += 1
            if r['example'] == '-':
                r['example'] = ''.join(str(t) for t in trail)
                parts = []
                for i in unfinished:
                    holds = [NAMES[l] for l in range(4) if st['owner'][l] == i]
                    wants = NAMES[int(progs[i][st['pc'][i]][1:])]
                    parts.append(f"T{i} holds {''.join(holds) if holds else 'nothing'} wants {wants}")
                r['stuck'] = ' | '.join(parts)
            return
        for i in ready:
            owner = st['owner'][:]
            pc = st['pc'][:]
            op = progs[i][pc[i]]
            pc[i] += 1
            if op[0] == 'L':
                owner[int(op[1:])] = i
            if op[0] == 'U':
                owner[int(op[1:])] = -1
            trail.append(i)
            walk({'owner': owner, 'pc': pc})
            trail.pop()

    walk({'owner': [-1, -1, -1, -1], 'pc': [0] * n})
    return r


# Part 2. Each thread does `jobs` jobs: `outside` ticks of work that needs no lock, then `hold` ticks inside one lock chosen
# from `locks` of them (job number + thread number, modulo the lock count). A busy lock is queued in arrival order.
def contention(threads, locks, hold, outside, jobs):
    phase = ['out'] * threads
    rem = [outside] * threads
    job = [0] * threads
    owner = [-1] * locks
    queue = [[] for _ in range(locks)]
    finished = t = waiting = longest = 0
    while finished < threads:
        for i in range(threads):
            if phase[i] == 'out':
                rem[i] -= 1
                if rem[i] == 0:
                    phase[i] = 'wait'
                    queue[(i + job[i]) % locks].append(i)
            elif phase[i] == 'hold':
                rem[i] -= 1
                if rem[i] == 0:
                    owner[(i + job[i]) % locks] = -1
                    job[i] += 1
                    if job[i] == jobs:
                        phase[i] = 'done'
                        finished += 1
                    else:
                        phase[i] = 'out'
                        rem[i] = outside
        for l in range(locks):
            if owner[l] == -1 and queue[l]:
                i = queue[l].pop(0)
                owner[l] = i
                phase[i] = 'hold'
                rem[i] = hold
        for l in range(locks):
            waiting += len(queue[l])
            if len(queue[l]) > longest:
                longest = len(queue[l])
        t += 1
    return {'ticks': t, 'waiting': waiting, 'longest': longest, 'alone': threads * jobs * (outside + hold)}


print('== lock order: every interleaving')
for name in SCENARIOS:
    r = explore(SCENARIOS[name])
    print(f"{name:<12} threads={len(SCENARIOS[name])} schedules={r['complete'] + r['deadlocked']:<5} deadlocked={r['deadlocked']:<5} first={r['example']} stuck: {r['stuck']}")
print('== contention: 20 jobs per thread, 20 ticks of work outside the lock')
for hold in [2, 20]:
    for locks in [1, 4]:
        for threads in [1, 2, 4, 8, 16]:
            c = contention(threads, locks, hold, 20, 20)
            wait_pct = (c['waiting'] * 100) // (threads * c['ticks'])
            print(f"hold={hold:<3} locks={locks} threads={threads:<3} ticks={c['ticks']:<6} speedup_x10={(c['alone'] * 10) // c['ticks']:<4} waiting%={wait_pct:<3} longest queue={c['longest']}")
