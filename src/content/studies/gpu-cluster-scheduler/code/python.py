# A gang scheduler for a small GPU cluster, in Python:
# a job gets all its GPUs at once or waits, teams are ordered by fair share, placement keeps a big job inside one rack,
# and backfill lets short jobs use the gaps without delaying the job at the head of the queue.

NODES, PER_NODE, RACK = 8, 8, 4  # 8 nodes of 8 GPUs, 2 racks of 4 nodes (64 GPUs)
seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


sizes = [1, 2, 4, 8, 8, 16, 16, 32]
jobs = []
for i in range(40):
    jobs.append({'id': i, 'gpus': sizes[random(8)], 'team': random(3), 'dur': 2 + random(9), 'submit': random(8)})
jobs.sort(key=lambda j: j['submit'] * 100 + j['id'])


# Returns [(node, count), ...] or None. Small jobs: the tightest node that fits. Big jobs: whole free nodes inside one rack.
def place(free, gpus):
    if gpus <= PER_NODE:
        best = -1
        for n in range(NODES):
            if free[n] >= gpus and (best < 0 or free[n] < free[best]):
                best = n
        return None if best < 0 else [(best, gpus)]
    need = gpus // PER_NODE
    for r in range(NODES // RACK):
        whole = [(n, PER_NODE) for n in range(r * RACK, (r + 1) * RACK) if free[n] == PER_NODE]
        if len(whole) >= need:
            return whole[:need]
    return None


def run(backfill):
    free = [PER_NODE] * NODES
    usage = [0, 0, 0]
    pending = [dict(j) for j in jobs]
    running = []
    done = wait_sum = busy = t = 0
    while done < len(jobs) and t < 1000:
        for j in [r for r in running if r['end'] == t]:
            for n, c in j['slots']:
                free[n] += c
            done += 1
        running = [r for r in running if r['end'] != t]
        queue = sorted((j for j in pending if j['submit'] <= t and 'slots' not in j),
                       key=lambda j: (usage[j['team']], j['submit'], j['id']))
        shadow = -1  # when the blocked head could start, once the running jobs finish
        for j in queue:
            if shadow >= 0 and not (backfill and t + j['dur'] <= shadow):
                continue
            slots = place(free, j['gpus'])
            if slots:
                for n, c in slots:
                    free[n] -= c
                if sum(c for _, c in slots) != j['gpus'] or any(f < 0 for f in free):
                    raise RuntimeError('gang broken')
                j['slots'], j['end'] = slots, t + j['dur']
                running.append(j)
                wait_sum += t - j['submit']
                continue
            if shadow < 0:
                if not backfill:
                    break
                copy = list(free)
                for r in sorted(running, key=lambda r: r['end']):
                    for n, c in r['slots']:
                        copy[n] += c
                    if place(copy, j['gpus']):
                        shadow = r['end']
                        break
        for r in running:
            usage[r['team']] += r['gpus']
            busy += r['gpus']
        t += 1
    if done != len(jobs) or any(f != PER_NODE for f in free):
        raise RuntimeError('not all jobs finished')
    return {'makespan': t, 'wait': wait_sum // len(jobs), 'util': (100 * busy) // (t * NODES * PER_NODE), 'usage': usage}


fifo, fill = run(False), run(True)
print(f"jobs: {len(jobs)}, GPUs requested in total: {sum(j['gpus'] for j in jobs)}, cluster: {NODES * PER_NODE} GPUs")
for name, r in (('strict queue', fifo), ('with backfill', fill)):
    print(f"{name}: finished at t={r['makespan']}, average wait {r['wait']}, utilisation {r['util']}%, GPU-ticks per team {'/'.join(str(u) for u in r['usage'])}")
print(f"backfill finishes {fifo['makespan'] - fill['makespan']} ticks earlier")
