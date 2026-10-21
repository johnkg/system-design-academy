# A tiny cluster control plane in Python:
# controllers compare desired and actual state, a scheduler filters then scores nodes,
# and a node controller evicts the pods of a node whose heartbeats stop for longer than the grace period.
import sys

NODES, CPU, MEM, BEAT, END = 8, 16, 64, 10, 200
DEPLOYMENTS = [
    {'name': 'web', 'replicas': 16, 'cpu': 2, 'mem': 4},
    {'name': 'cache', 'replicas': 4, 'cpu': 1, 'mem': 16},
    {'name': 'batch', 'replicas': 6, 'cpu': 4, 'mem': 8},
]
TOTAL_PODS = sum(d['replicas'] for d in DEPLOYMENTS)
SEED, SCORE_SCALE = 42, 1000  # free capacity is compared in thousandths
BINDS_PER_SECOND, SPREAD_AT = 4, 20
LONG_GRACE, SHORT_GRACE, KILL_AT, LOSS_PERCENT = 40, 5, 100, 10


def simulate(grace, loss_percent, kill_at):
    seed = SEED

    def random(n):
        """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return (seed // 65536) % n

    nodes = [{'id': i, 'last_beat': 0, 'ready': True, 'dead': False} for i in range(NODES)]
    pods = []  # the store: every pod object, with the node it is bound to (-1 while unscheduled)
    next_id = 1
    r = {'evictions': 0, 'false_evictions': 0, 'killed': -1, 'killed_pods': 0, 'not_ready_at': -1, 'restored_at': -1, 'max_cpu': 0, 'max_mem': 0, 'spread': ''}

    def used(n, key):
        return sum(p[key] for p in pods if p['node'] == n['id'])

    # Filter: ready nodes with enough unrequested CPU and memory. Score: the most even CPU and memory use afterwards. Ties go to the lower id.
    def schedule(pod):
        best, best_score = None, float('inf')
        for n in nodes:
            free_cpu = CPU - used(n, 'cpu') - pod['cpu']
            free_mem = MEM - used(n, 'mem') - pod['mem']
            if not n['ready'] or free_cpu < 0 or free_mem < 0:
                continue
            score = abs((free_cpu * SCORE_SCALE) // CPU - (free_mem * SCORE_SCALE) // MEM)
            if score < best_score:
                best, best_score = n, score
        if best:
            pod['node'] = best['id']

    for t in range(1, END + 1):
        if t == kill_at:  # the busiest node loses power
            victim = nodes[0]
            for n in nodes:
                if sum(1 for p in pods if p['node'] == n['id']) > sum(1 for p in pods if p['node'] == victim['id']):
                    victim = n
            victim['dead'] = True
            r['killed'] = victim['id']
            r['killed_pods'] = sum(1 for p in pods if p['node'] == victim['id'])
        for n in nodes:  # kubelets send a heartbeat every BEAT seconds; a lossy network drops some of them
            if t % BEAT != n['id'] % BEAT or n['dead']:
                continue
            if random(100) >= loss_percent:
                n['last_beat'] = t
                n['ready'] = True
        for n in nodes:  # node controller: no heartbeat for longer than the grace period means NotReady, so evict its pods
            if n['ready'] and t - n['last_beat'] > grace:
                n['ready'] = False
                r['evictions'] += 1
                if not n['dead']:
                    r['false_evictions'] += 1
                else:
                    r['not_ready_at'] = t
                pods = [p for p in pods if p['node'] != n['id']]
        for d in DEPLOYMENTS:  # replica controller: make the actual count match the desired count
            have = sum(1 for p in pods if p['dep'] == d['name'])
            for _ in range(have, d['replicas']):
                pods.append({'id': next_id, 'dep': d['name'], 'cpu': d['cpu'], 'mem': d['mem'], 'node': -1})
                next_id += 1
        for p in [p for p in pods if p['node'] < 0][:BINDS_PER_SECOND]:  # the scheduler binds at most 4 pods per second
            schedule(p)
        for n in nodes:
            r['max_cpu'] = max(r['max_cpu'], used(n, 'cpu'))
            r['max_mem'] = max(r['max_mem'], used(n, 'mem'))
        if t == SPREAD_AT:
            r['spread'] = ' '.join(str(sum(1 for p in pods if p['node'] == n['id'])) for n in nodes)
        if r['killed'] >= 0 and t > kill_at and r['restored_at'] < 0 and len(pods) == TOTAL_PODS and all(p['node'] >= 0 and not nodes[p['node']]['dead'] for p in pods):
            r['restored_at'] = t
    r['final_bound'] = sum(1 for p in pods if p['node'] >= 0 and not nodes[p['node']]['dead'])
    return r


a = simulate(LONG_GRACE, 0, KILL_AT)
print(f"pods per node at t=20: {a['spread']}")
print(f"node {a['killed']} died at t=100 with {a['killed_pods']} pods; marked NotReady at t={a['not_ready_at']}; all 26 pods bound again at t={a['restored_at']}")
b, c = simulate(SHORT_GRACE, LOSS_PERCENT, -1), simulate(LONG_GRACE, LOSS_PERCENT, -1)
print(f"healthy nodes, 10% of heartbeats lost: grace 5 s gives {b['false_evictions']} false evictions, grace 40 s gives {c['false_evictions']}")

ok = (a['max_cpu'] <= CPU and a['max_mem'] <= MEM and b['max_cpu'] <= CPU and b['max_mem'] <= MEM
      and a['final_bound'] == TOTAL_PODS and a['restored_at'] > a['not_ready_at'] and a['not_ready_at'] - KILL_AT <= LONG_GRACE + BEAT + 1
      and b['false_evictions'] > 0 and c['false_evictions'] == 0)
print(f"no node over-committed, desired equals actual, no flapping at 40 s: {str(ok).lower()}")
if not ok:
    sys.exit(1)
