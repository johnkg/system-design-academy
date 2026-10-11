# A tiny lakehouse table in Python: immutable data files, a snapshot per commit,
# optimistic commits that rebase or abort, compaction, time travel and vacuum.
import sys


class Table:
    def __init__(self):
        self.snaps = [[]]  # a snapshot is a list of (file, rows)
        self.store = {}
        self.seq = 0
        self.oldest = 0

    @property
    def head(self):
        return len(self.snaps) - 1

    def new_file(self, rows):
        self.seq += 1
        name = f'f{self.seq}'
        self.store[name] = rows  # uploaded before it is committed
        return (name, rows)

    def begin(self):
        return {'base': self.head, 'add': [], 'remove': [], 'rows': 0}

    # Commit succeeds only if nobody committed since tx['base']. Otherwise rebase on the new head,
    # unless a file this transaction wants to remove is already gone: that is a real conflict.
    def commit(self, tx):
        rebases = 0
        while True:
            if tx['base'] == self.head:
                kept = [f for f in self.snaps[self.head] if f[0] not in tx['remove']]
                self.snaps.append(kept + tx['add'])
                return True, rebases
            now = [f[0] for f in self.snaps[self.head]]
            if any(n not in now for n in tx['remove']):
                return False, rebases
            tx['base'] = self.head
            rebases += 1

    def total(self, v):
        if v < self.oldest:
            raise ValueError(f'snapshot {v} expired')
        return sum(r for _, r in self.snaps[v])

    def vacuum(self, keep):  # forget old snapshots, then delete files that no kept snapshot uses
        self.oldest = self.head - keep + 1
        live = {n for snap in self.snaps[self.oldest:] for n, _ in snap}
        for n in list(self.store):
            if n not in live:
                del self.store[n]


seed = 7


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 8) % n


t = Table()
history = [0]  # history[v] = rows at version v, written down at commit time
expected = 0
rebases = 0


def done(tx):
    global rebases
    ok, r = t.commit(tx)
    if not ok:
        raise RuntimeError('unexpected conflict')
    rebases += r
    history.append(t.total(t.head))


for _ in range(12):  # three writers start from the same snapshot every round
    txs = []
    for _ in range(3):
        tx = t.begin()
        tx['rows'] = 10 + rnd(40)
        tx['add'].append(t.new_file(tx['rows']))
        txs.append(tx)
    for tx in txs:
        done(tx)
        expected += tx['rows']
print(f"appends: version {t.head}, {len(t.snaps[t.head])} files, {t.total(t.head)} rows, {rebases} rebases")


def plan():  # merge every small file into one
    tx = t.begin()
    small = [f for f in t.snaps[tx['base']] if f[1] < 30]
    tx['remove'] = [n for n, _ in small]
    tx['add'].append(t.new_file(sum(r for _, r in small)))
    return tx


compaction = plan()
append = t.begin()
append['add'].append(t.new_file(25))
delete = t.begin()
victim = compaction['remove'][0]
delete['remove'] = [victim]
delete['add'].append(t.new_file(t.store[victim] - 5))
done(append)
expected += 25
done(delete)
expected -= 5
conflicts = 0
while not t.commit(compaction)[0]:
    conflicts += 1
    compaction = plan()  # replan from the new head
history.append(t.total(t.head))
print(f"compaction: {conflicts} conflict, version {t.head}, {len(t.snaps[t.head])} files, {t.total(t.head)} rows")

before = len(t.store)
t.vacuum(3)
print(f"vacuum: {before} stored files -> {len(t.store)}")
expired = False
try:
    t.total(3)
except ValueError:
    expired = True
travel = all(t.total(v) == history[v] for v in (t.head - 2, t.head - 1, t.head))
print(f"time travel matches history: {str(travel).lower()}; version 3 expired: {str(expired).lower()}")
if t.total(t.head) != expected or not travel or not expired or conflicts != 1:
    sys.exit(1)
