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


SEED, ROUNDS, WRITERS, MIN_ROWS, ROW_SPREAD = 7, 12, 3, 10, 40
SMALL_FILE_ROWS = 30  # compaction merges files smaller than this
APPEND_ROWS, DELETED_ROWS, KEEP_SNAPSHOTS, OLD_VERSION = 25, 5, 3, 3
seed = SEED


def rnd(n):
    """Linear congruential generator (Numerical Recipes constants), top 24 bits."""
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


for _ in range(ROUNDS):  # three writers start from the same snapshot every round
    txs = []
    for _ in range(WRITERS):
        tx = t.begin()
        tx['rows'] = MIN_ROWS + rnd(ROW_SPREAD)
        tx['add'].append(t.new_file(tx['rows']))
        txs.append(tx)
    for tx in txs:
        done(tx)
        expected += tx['rows']
print(f"appends: version {t.head}, {len(t.snaps[t.head])} files, {t.total(t.head)} rows, {rebases} rebases")


def plan():  # merge every small file into one
    tx = t.begin()
    small = [f for f in t.snaps[tx['base']] if f[1] < SMALL_FILE_ROWS]
    tx['remove'] = [n for n, _ in small]
    tx['add'].append(t.new_file(sum(r for _, r in small)))
    return tx


compaction = plan()
append = t.begin()
append['add'].append(t.new_file(APPEND_ROWS))
delete = t.begin()
victim = compaction['remove'][0]
delete['remove'] = [victim]
delete['add'].append(t.new_file(t.store[victim] - DELETED_ROWS))
done(append)
expected += APPEND_ROWS
done(delete)
expected -= DELETED_ROWS
conflicts = 0
while not t.commit(compaction)[0]:
    conflicts += 1
    compaction = plan()  # replan from the new head
history.append(t.total(t.head))
print(f"compaction: {conflicts} conflict, version {t.head}, {len(t.snaps[t.head])} files, {t.total(t.head)} rows")

before = len(t.store)
t.vacuum(KEEP_SNAPSHOTS)
print(f"vacuum: {before} stored files -> {len(t.store)}")
expired = False
try:
    t.total(OLD_VERSION)
except ValueError:
    expired = True
travel = all(t.total(v) == history[v] for v in (t.head - 2, t.head - 1, t.head))
print(f"time travel matches history: {str(travel).lower()}; version 3 expired: {str(expired).lower()}")
if t.total(t.head) != expected or not travel or not expired or conflicts != 1:
    sys.exit(1)
