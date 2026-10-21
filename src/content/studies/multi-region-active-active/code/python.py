# Three active-active regions in Python:
# a last-writer-wins register loses concurrent increments and obeys a skewed clock, while a counter CRDT merges to the exact total.
import sys

SKEW = [0, 2, -3]  # each region's wall clock is a little off
REGIONS = len(SKEW)
STEPS = 600
REPLICATE_ONE_IN = 4  # a replication round on one step in 4
seed = 7


def rand(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


# Last-writer-wins: the higher timestamp wins, and the higher region id breaks a tie.
def lww_wins(a, b):
    return a['ts'] > b['ts'] or (a['ts'] == b['ts'] and a['region'] > b['region'])


def lww_merge(mine, theirs):
    return dict(theirs) if lww_wins(theirs, mine) else mine


class Region:
    def __init__(self, id):
        self.id = id
        self.likes = {'value': 0, 'ts': 0, 'region': id}  # likes kept as one LWW register
        self.counts = [0, 0, 0]                           # likes kept as a G-counter: one slot per region
        self.name = {'value': 'none', 'ts': 0, 'region': id}

    def clock(self, step):
        return step + SKEW[self.id]

    def like(self, step):
        self.likes = {'value': self.likes['value'] + 1, 'ts': self.clock(step), 'region': self.id}  # read, add one, write back
        self.counts[self.id] += 1

    def rename(self, step, value):
        self.name = {'value': value, 'ts': self.clock(step), 'region': self.id}

    def merge_from(self, other):  # replication: apply the other region's state
        self.likes = lww_merge(self.likes, other.likes)
        self.name = lww_merge(self.name, other.name)
        self.counts = [max(c, other.counts[i]) for i, c in enumerate(self.counts)]

    def total(self):
        return sum(self.counts)


regions = [Region(i) for i in range(REGIONS)]
truth = 0
for step in range(1, STEPS + 1):
    r = rand(REGIONS)
    regions[r].like(step)
    truth += 1
    if step == 100:
        regions[0].rename(step, 'alice-old')
    if step == 101:
        regions[2].rename(step, 'alice-new')  # really later, but region 2's clock runs 3 behind
    if rand(REPLICATE_ONE_IN) == 0:  # lazy replication between random pairs
        src = rand(REGIONS)
        dst = (src + 1 + rand(REGIONS - 1)) % REGIONS
        regions[dst].merge_from(regions[src])

print(f"likes really given: {truth}")
print(f"before sync, LWW likes per region: {', '.join(str(r.likes['value']) for r in regions)}")
print(f"before sync, CRDT likes per region: {', '.join(str(r.total()) for r in regions)}")

for _ in range(2):  # anti-entropy: every pair exchanges state
    for a in regions:
        for b in regions:
            if a is not b:
                a.merge_from(b)

lww = [r.likes['value'] for r in regions]
crdt = [r.total() for r in regions]
print(f"after sync, LWW likes: {', '.join(map(str, lww))} (lost {truth - lww[0]})")
print(f"after sync, CRDT likes: {', '.join(map(str, crdt))} (lost {truth - crdt[0]})")
print(f"name everywhere: {', '.join(r.name['value'] for r in regions)}")

converged = len(set(lww)) == 1 and len(set(crdt)) == 1 and len({r.name['value'] for r in regions}) == 1
print(f"converged: {'true' if converged else 'false'}")
if not converged or crdt[0] != truth or lww[0] >= truth or regions[0].name['value'] != 'alice-old':
    sys.exit(1)
