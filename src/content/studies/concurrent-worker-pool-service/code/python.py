# A job service for 4 tenants, second by second for 500 seconds. Tenant 0 is the noisy one: it submits a burst of 12
# jobs a second between 100 s and 200 s. The three others submit one job a second each. A job needs 2 core-seconds on
# a 16-core machine. Running more jobs at once than there are cores shares the cores and wastes some on switching.
# Some jobs fail, some after their side effect already happened. A deploy can restart the workers at 151 s.
# Everything is integers from a seeded generator, so the output never changes.
TICKS, TENANTS = 500, 4
CORES = 16            # cores per machine
COST = 2000           # work units a job needs; a core does 1,000 a second
MAX_THREADS = 250     # a thread per job: past this many at once the process runs out of memory and dies
BURST_AT, BURST_END, BURST = 100, 200, 12
QMAX, FAIR_QMAX = 200, 50  # bounded queue: all tenants together, or per tenant
FAIL_PCT, EFFECT_PCT, MAX_TRIES = 10, 50, 3  # a failure happens after the side effect half of the time
RESTART_AT, DRAIN, GAP = 151, 10, 5
CHECK_EVERY, WAIT_LIMIT, BOOT, MAX_MACHINES = 10, 5, 20, 4  # autoscaler on the age of the oldest job


def rate(n, cores):
    if n <= cores:
        return 1000
    ovh = min(600, (n - cores) * 8)
    return ((1000 * cores // n) * (1000 - ovh)) // 1000


class Job:
    def __init__(self, jid, tenant, t0):
        self.id, self.tenant, self.t0 = jid, tenant, t0
        self.tries, self.prog, self.effect = 0, 0, False


def run(name, exec_mode, queue, noisy, retry, deploy):
    seed = 4242

    def rnd():
        nonlocal seed
        seed = (seed * 48271) % 2147483647
        return seed

    shared, per = [], [[], [], [], []]
    pending = []
    running = []
    machines, rr, paused, resume_at, drain_end = 1, 0, False, -1, -1
    sub, rej, done = [0, 0], [0, 0], [0, 0]  # [noisy, others]
    lat = {}
    c = dict(next_id=0, lost=0, lost_others=0, crashes=0, killed=0, dup=0, failed=0, dead=0, peak=0, machine_ticks=0)

    def g(tenant):
        return 0 if tenant == 0 else 1

    def queued():
        return sum(len(q) for q in per) if queue == 'fair' else len(shared)

    def lose(j):
        c['lost'] += 1
        if j.tenant != 0:
            c['lost_others'] += 1

    def answer(j, t):  # the caller got an answer
        if j.tenant != 0:
            d = t - j.t0 + 1
            lat[d] = lat.get(d, 0) + 1

    def finish(j, t):
        done[g(j.tenant)] += 1
        answer(j, t)

    def requeue(j):
        (per[j.tenant] if queue == 'fair' else shared).append(j)

    def workers():
        if exec_mode == 'auto':
            return CORES * machines
        return int(exec_mode)

    for t in range(TICKS):
        for i in range(len(pending) - 1, -1, -1):
            if pending[i] <= t:
                machines += 1
                del pending[i]
        for tenant in range(TENANTS):
            if tenant == 0:
                n = BURST if (noisy and BURST_AT <= t < BURST_END) else (1 if t % 2 == 0 else 0)
            else:
                n = 1
            for _ in range(n):
                j = Job(c['next_id'], tenant, t)
                c['next_id'] += 1
                sub[g(tenant)] += 1
                if exec_mode == 'thread':
                    running.append(j)
                elif queue == 'fair':
                    if len(per[tenant]) >= FAIR_QMAX:
                        rej[g(tenant)] += 1
                    else:
                        per[tenant].append(j)
                elif queue == 'bounded' and len(shared) >= QMAX:
                    rej[g(tenant)] += 1
                else:
                    shared.append(j)
        if exec_mode == 'thread' and len(running) > MAX_THREADS:
            c['crashes'] += 1
            for j in running:
                lose(j)
            running = []
        if t == RESTART_AT and deploy != 'none':
            if exec_mode == 'thread' or deploy == 'abrupt':
                for j in running:
                    c['killed'] += 1
                    if exec_mode == 'thread' or retry == 'none':
                        lose(j)
                    else:
                        j.prog = 0
                        requeue(j)
                running = []
                resume_at = t if exec_mode == 'thread' else t + GAP
            else:
                paused = True
                drain_end = t + DRAIN
        if paused and (len(running) == 0 or t >= drain_end):
            for j in running:
                c['killed'] += 1
                if retry == 'none':
                    lose(j)
                else:
                    j.prog = 0
                    requeue(j)
            running = []
            paused = False
            resume_at = t + GAP
        if exec_mode == 'auto' and t % CHECK_EVERY == 0:
            oldest = 0
            for q in (per if queue == 'fair' else [shared]):
                if q:
                    oldest = max(oldest, t - q[0].t0)
            if oldest > WAIT_LIMIT and machines + len(pending) < MAX_MACHINES:
                pending.append(t + BOOT)
            elif queued() == 0 and machines > 1 and len(pending) == 0:
                machines -= 1
        if exec_mode != 'thread' and not paused and t >= resume_at:
            while len(running) < workers() and queued() > 0:
                if queue == 'fair':
                    tenant = rr
                    while len(per[tenant]) == 0:
                        tenant = (tenant + 1) % TENANTS
                    running.append(per[tenant].pop(0))
                    rr = (tenant + 1) % TENANTS
                else:
                    running.append(shared.pop(0))
        c['machine_ticks'] += machines if exec_mode == 'auto' else 1
        c['peak'] = max(c['peak'], len(running))
        r = rate(len(running), CORES * (machines if exec_mode == 'auto' else 1))
        still = []
        for j in running:
            j.prog += r
            if j.prog < COST:
                still.append(j)
                continue
            if rnd() % 100 >= FAIL_PCT:
                if j.effect:
                    c['dup'] += 1
                j.effect = True
                finish(j, t)
                continue
            if rnd() % 100 < EFFECT_PCT:
                if j.effect:
                    c['dup'] += 1
                j.effect = True
            if retry == 'none':
                c['failed'] += 1
                answer(j, t)
                continue
            if j.effect and retry == 'idem':
                finish(j, t)
                continue
            j.tries += 1
            if j.tries >= MAX_TRIES:
                c['dead'] += 1
                answer(j, t)
                continue
            j.prog = 0
            if exec_mode == 'thread':
                still.append(j)
            else:
                requeue(j)
        running = still
    admitted = sub[1] - rej[1]
    seen, p95 = 0, -1
    for k in sorted(lat):
        seen += lat[k]
        if p95 < 0 and seen * 100 >= admitted * 95:
            p95 = k
    p95_text = 'over 500 s' if p95 < 0 or p95 > TICKS else f'{p95} s'
    print(f'-- {name}')
    print(f"  other tenants: p95 {p95_text}; {done[1]} of {sub[1]} done, {rej[1]} rejected, {c['lost_others']} lost")
    print(f'  noisy tenant: {done[0]} of {sub[0]} done, {rej[0]} rejected')
    print(f"  peak {c['peak']} running at once, {c['crashes']} crashes, {c['killed']} killed by the deploy, {c['lost']} jobs lost, {c['machine_ticks']} machine-seconds")
    print(f"  duplicate side effects {c['dup']}, failed without retry {c['failed']}, given up after {MAX_TRIES} tries {c['dead']}")
    if done[0] + done[1] + rej[0] + rej[1] > sub[0] + sub[1]:
        raise RuntimeError('impossible count')


def base(**kw):
    o = dict(exec_mode='16', queue='unbounded', noisy=True, retry='none', deploy='none')
    o.update(kw)
    return o


run('a thread per job, noisy tenant', **base(exec_mode='thread'))
run('16 workers, one unbounded queue', **base())
run('64 workers, one unbounded queue', **base(exec_mode='64'))
run('16 workers, bounded queue of 200', **base(queue='bounded'))
run('16 workers, fair queues of 50 each', **base(queue='fair'))
run('autoscaled, fair queues', **base(exec_mode='auto', queue='fair'))
run('16 workers, fair, no noisy tenant', **base(queue='fair', noisy=False))
run('16 workers, fair, retries without idempotency', **base(queue='fair', retry='retry'))
run('16 workers, fair, retries with idempotency', **base(queue='fair', retry='idem'))
run('16 workers, fair, idempotent, abrupt restart', **base(queue='fair', retry='idem', deploy='abrupt'))
run('16 workers, fair, idempotent, drain then restart', **base(queue='fair', retry='idem', deploy='drain'))
