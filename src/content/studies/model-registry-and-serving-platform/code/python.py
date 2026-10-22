# A model registry in Python: immutable checksummed versions, gated promotion with approval,
# rollback, a sticky canary traffic split, and the scale-from-zero arithmetic.
import math
import sys

MAX_P95_MS, MAX_ACC_DROP = 120, 5  # the eval gate; accuracy is in per mille
REQUESTS, CANARY_PCT, WIDER_PCT = 10000, 10, 25
BOOT_S, QUEUE_PER_REPLICA = 6, 8  # fixed start-up time; queued requests one replica absorbs
MODEL_MB, NETWORK_MBPS, LOCAL_MBPS = 14000, 1000, 5000

# 32-bit FNV-1a hash, used here as the checksum of the weights and as the traffic-split hash.
def fnv(s):
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def checksum(weights):
    return format(fnv(weights), '08x')


class Registry:
    def __init__(self):
        self.versions = []

    # Publishing the same bytes again returns the existing version, so a retried upload creates no duplicate.
    def publish(self, weights, author):
        total = checksum(weights)
        for v in self.versions:
            if v['sum'] == total:
                return v
        v = {'n': len(self.versions) + 1, 'weights': weights, 'sum': total, 'author': author, 'stage': 'none', 'evals': None}
        self.versions.append(v)
        return v

    # The eval gate: accuracy (per mille) must not drop more than 5 below production, and p95 latency must stay at or below 120 ms.
    def stage(self, n, evals):
        v = self.versions[n - 1]
        prod = self.production()
        if checksum(v['weights']) != v['sum']:
            return f'v{n} refused: checksum mismatch'
        if evals['p95'] > MAX_P95_MS:
            return f"v{n} blocked: p95 {evals['p95']} ms is over 120 ms"
        if prod and evals['acc'] < prod['evals']['acc'] - MAX_ACC_DROP:
            return f"v{n} blocked: accuracy {evals['acc']} is below production"
        v['evals'] = evals
        v['stage'] = 'staging'
        return f'v{n} is in staging'

    # Production needs a passed staging gate and an approver who is not the author.
    def promote(self, n, approver):
        v = self.versions[n - 1]
        if v['stage'] != 'staging':
            return f'v{n} refused: not in staging'
        if approver == v['author']:
            return f'v{n} refused: the author cannot approve'
        prod = self.production()
        if prod:
            prod['stage'] = 'archived'
        v['stage'] = 'production'
        return f'v{n} is in production, approved by {approver}'

    def production(self):
        return next((v for v in self.versions if v['stage'] == 'production'), None)

    # Rollback is a pointer move to the newest archived version: nothing is rebuilt or copied.
    def rollback(self):
        prev = next(v for v in reversed(self.versions) if v['stage'] == 'archived')
        self.production()['stage'] = 'rolled-back'
        prev['stage'] = 'production'
        return f"rolled back to v{prev['n']}"


reg = Registry()
v1, v2, v3 = reg.publish('weights-alpha', 'ana'), reg.publish('weights-beta', 'ana'), reg.publish('weights-gamma', 'ana')
print(f"published v1={v1['sum']} v2={v2['sum']} v3={v3['sum']}; same bytes again gives v{reg.publish('weights-beta', 'ana')['n']}")
print(reg.stage(1, {'acc': 912, 'p95': 80}), '|', reg.promote(1, 'bob'))
print(reg.stage(2, {'acc': 925, 'p95': 95}), '|', reg.promote(2, 'ana'), '|', reg.promote(2, 'bob'))
print(reg.stage(3, {'acc': 931, 'p95': 160}))
print(f"tampered copy of v2 passes the checksum: {str(checksum('weights-beta!') == v2['sum']).lower()}")


# A request id always lands on the same side, and raising the canary share only moves requests onto the canary.
def to_canary(i, pct):
    return fnv(f'req-{i}') % 100 < pct


at10 = at25 = 0
sticky = nested = True
for i in range(REQUESTS):
    a, b = to_canary(i, CANARY_PCT), to_canary(i, WIDER_PCT)
    at10 += a
    at25 += b
    if a != to_canary(i, CANARY_PCT):
        sticky = False
    if a and not b:
        nested = False
print(f"canary share: {at10} of 10000 at 10%, {at25} at 25%; sticky {str(sticky).lower()}; nested {str(nested).lower()}")


# Scale from zero: a cold replica pays 6 s of start-up plus the weight download. Replicas follow the queue at 8 requests each.
def cold_start(size_mb, mb_per_sec):
    return BOOT_S + math.ceil(size_mb / mb_per_sec)


def replicas(queue):
    return math.ceil(queue / QUEUE_PER_REPLICA)


print(f"cold start for 14000 MB: {cold_start(MODEL_MB, NETWORK_MBPS)} s from the network, {cold_start(MODEL_MB, LOCAL_MBPS)} s from a local cache; replicas for queue 0, 5, 50: {', '.join(str(replicas(q)) for q in (0, 5, 50))}")

print(reg.rollback())
if reg.production()['n'] != 1 or at10 < 800 or at10 > 1200 or not sticky or not nested or checksum('weights-beta!') == v2['sum']:
    sys.exit(1)
