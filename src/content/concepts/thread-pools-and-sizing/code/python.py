# Thread pool: a tick simulation (no real threads, no clock) of jobs waiting in a queue for a fixed set of worker threads.
# The machine has 4 cores. A thread that waits for I/O keeps its place in the pool but uses no core. When more threads
# want a core than there are cores, the cores are shared round-robin. Model assumption: a tick is one unit of work;
# switching between threads costs nothing here, although real thread switching and memory per thread do cost something.
# Look for: IO jobs need about 12 threads (arrival rate x time in system); more than that gains nothing; CPU jobs gain
# nothing beyond 4 threads; fan-out jobs that wait for a sub-job in the SAME pool deadlock when the pool is small.
CORES = 4
WORKLOADS = {
    'cpu': {'jobs': 60, 'gap': 1},     # 8 ticks of CPU each, one job per tick
    'io': {'jobs': 60, 'gap': 1},      # 2 ticks of CPU, then 10 ticks waiting for I/O
    'fanout': {'jobs': 30, 'gap': 1},  # 1 tick CPU, submit a 3-tick child to the same pool and wait for it, then 1 tick CPU
}


def simulate(workload, pool, qbound):
    w = WORKLOADS[workload]
    queue = []
    th = [{'state': 'free', 'rem': 0, 'job': None, 'last': -1, 'phase': 0} for _ in range(pool)]
    s = {'next': 0, 'rejected': 0, 'done': 0, 'sum': 0, 'peak_queue': 0, 'peak_threads': 0, 'ticks': 0, 'deadlock': False}

    def complete(x, t):
        if x['job']['kind'] == 'job':
            s['done'] += 1
            s['sum'] += t + 1 - x['job']['arrive']
        else:
            p = th[x['job']['parent']]
            p['state'] = 'cpu'
            p['rem'] = 1
            p['phase'] = 2
        x['state'] = 'free'
        x['job'] = None

    for t in range(5000):
        if s['next'] < w['jobs'] and t % w['gap'] == 0:
            if qbound > 0 and len(queue) >= qbound:
                s['rejected'] += 1
            else:
                queue.append({'kind': 'job', 'arrive': t})
            s['next'] += 1
        for x in th:
            if x['state'] == 'free' and queue:
                x['job'] = queue.pop(0)
                x['phase'] = 1
                x['state'] = 'cpu'
                if workload == 'cpu':
                    x['rem'] = 8
                elif workload == 'io':
                    x['rem'] = 2
                else:
                    x['rem'] = 3 if x['job']['kind'] == 'child' else 1
        if len(queue) > s['peak_queue']:
            s['peak_queue'] = len(queue)
        busy = sum(1 for x in th if x['state'] != 'free')
        if busy > s['peak_threads']:
            s['peak_threads'] = busy
        running = sorted([i for i in range(pool) if th[i]['state'] == 'cpu'], key=lambda i: (th[i]['last'], i))[:CORES]
        for i in running:
            th[i]['rem'] -= 1
            th[i]['last'] = t
        for i in range(pool):
            if th[i]['state'] == 'io':
                th[i]['rem'] -= 1
        for i in range(pool):
            x = th[i]
            if x['rem'] != 0:
                continue
            if x['state'] == 'cpu':
                if workload == 'io' and x['phase'] == 1:
                    x['phase'] = 2
                    x['state'] = 'io'
                    x['rem'] = 10
                elif workload == 'fanout' and x['job']['kind'] == 'job' and x['phase'] == 1:
                    queue.append({'kind': 'child', 'parent': i})
                    x['state'] = 'blocked'
                    x['rem'] = -1
                else:
                    complete(x, t)
            elif x['state'] == 'io':
                complete(x, t)
        s['ticks'] = t + 1
        if s['done'] == w['jobs'] - s['rejected'] and s['next'] == w['jobs']:
            break
        if all(x['state'] == 'blocked' for x in th):
            s['deadlock'] = True
            break
    mean = s['sum'] // s['done'] if s['done'] else 0
    return {'done': s['done'], 'rejected': s['rejected'], 'ticks': s['ticks'], 'peak_queue': s['peak_queue'],
            'peak_threads': s['peak_threads'], 'mean': mean, 'per100': (s['done'] * 100) // s['ticks'], 'deadlock': s['deadlock']}


for workload, pools in [('cpu', [2, 4, 8, 64]), ('io', [4, 8, 12, 16, 64]), ('fanout', [2, 4, 8, 12, 16])]:
    print(f"== {workload}: {WORKLOADS[workload]['jobs']} jobs, one every {WORKLOADS[workload]['gap']} tick(s), unbounded queue")
    for pool in pools:
        r = simulate(workload, pool, 0)
        head = f"DEADLOCK at tick {r['ticks']}, {r['done']} done" if r['deadlock'] else f"ticks={r['ticks']:<5} done={r['done']}"
        print(f"pool={pool:<3} {head} per100={r['per100']:<4} mean latency={r['mean']:<4} peak queue={r['peak_queue']:<3} peak threads={r['peak_threads']}")
print('== io, pool 8: bounded queue of 10 rejects, unbounded keeps everything')
for q in [0, 10]:
    r = simulate('io', 8, q)
    label = 'none' if q == 0 else str(q)
    print(f"queue bound={label:<5} done={r['done']:<3} rejected={r['rejected']:<3} mean latency={r['mean']:<4} peak queue={r['peak_queue']}")
