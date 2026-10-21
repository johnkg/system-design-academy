# A live migration in Python: snapshot, then a change log replayed on the new database, chunk checksums, a cutover, and a way back.
# The "databases" are dicts from row id to value, so the idea fits on one screen.
import sys

UPDATE_UPTO = 6  # of every 10 writes: 6 updates, 2 inserts, 2 deletes
INSERT_UPTO = 8
MAX_VALUE = 1000  # row values are 0..999
CHUNK_ROWS = 100  # ids per checksum chunk
ROWS = 1000  # rows before the migration starts
COPY_TICKS = 10  # the bulk copy takes 10 ticks of 100 ids each
COPY_CHUNK = 100
WRITES_PER_TICK = 50  # application writes per tick
REPLAY_PER_TICK = 80  # log entries replayed per tick
FREEZE_LAG = 30  # freeze writes once the lag is below this
CLASH_PROBE = 50  # ids checked for a clash after the snapshot's counter
ID_GAP = 1000  # gap left between the old and the new id counters
WRITES_AFTER_FLIP = 200
SEED = 7
seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


class Db:
    def __init__(self):
        self.rows = {}
        self.log = []  # the change stream (a Postgres WAL, a MySQL binlog)
        self.next_id = 1

    def set(self, row_id, val):
        self.rows[row_id] = val
        self.log.append(("set", row_id, val))

    def delete(self, row_id):
        self.rows.pop(row_id, None)
        self.log.append(("del", row_id, 0))

    def apply(self, entry):  # idempotent: replaying an entry changes nothing; the id counter follows the highest id seen
        op, row_id, val = entry
        self.next_id = max(self.next_id, row_id + 1)
        if op == "set":
            self.rows[row_id] = val
        else:
            self.rows.pop(row_id, None)


def workload(db, n):  # updates, inserts and deletes, as the application keeps running
    for _ in range(n):
        r = random(10)
        if r < UPDATE_UPTO:
            row_id = 1 + random(db.next_id - 1)
            db.set(row_id, random(MAX_VALUE))
        elif r < INSERT_UPTO:
            row_id = db.next_id
            db.next_id += 1
            db.set(row_id, random(MAX_VALUE))
        else:
            db.delete(1 + random(db.next_id - 1))


def diverged(a, b):
    return sum(1 for i in range(1, max(a.next_id, b.next_id)) if a.rows.get(i, -1) != b.rows.get(i, -1))


def chunk_sums(db, size):  # one checksum per range of ids, cheap to compare even for billions of rows
    sums = {}
    for i in range(1, db.next_id):
        c = (i - 1) // size
        sums.setdefault(c, 0)
        if i in db.rows:
            sums[c] = (sums[c] * 31 + i * 1000 + db.rows[i]) & 0xFFFFFFFF
    return sums


def bad_chunks(a, b):
    x, y = chunk_sums(a, CHUNK_ROWS), chunk_sums(b, CHUNK_ROWS)
    return sum(1 for c in x if x[c] != y.get(c))


def build():
    global seed
    seed = SEED
    db = Db()
    for _ in range(ROWS):
        db.set(db.next_id, random(MAX_VALUE))
        db.next_id += 1
    db.log = []
    return db


# 1. Copying rows while the application writes, with no snapshot and no change log.
src, dst = build(), Db()
end = src.next_id
for t in range(COPY_TICKS):
    for i in range(1 + t * COPY_CHUNK, min(end, 1 + (t + 1) * COPY_CHUNK)):
        if i in src.rows:
            dst.rows[i] = src.rows[i]
    workload(src, WRITES_PER_TICK)
dst.next_id = src.next_id
naive = diverged(src, dst)
print(f"live copy with no change log: {naive} rows diverged")
if naive == 0:
    sys.exit(1)


# 2. Snapshot, bulk copy, then replay the change log, 80 entries per tick, until the lag is below 30.
def migrate(reverse):
    src = build()
    snap, snap_next, dst = dict(src.rows), src.next_id, Db()
    for t in range(COPY_TICKS):
        for i in range(1 + t * COPY_CHUNK, 1 + (t + 1) * COPY_CHUNK):
            if i in snap:
                dst.rows[i] = snap[i]
        workload(src, WRITES_PER_TICK)
    applied, ticks, start = 0, 0, len(src.log)
    while len(src.log) - applied >= FREEZE_LAG:
        workload(src, WRITES_PER_TICK)
        for _ in range(REPLAY_PER_TICK):
            if applied < len(src.log):
                dst.apply(src.log[applied])
                applied += 1
        ticks += 1
    lag, before = len(src.log) - applied, bad_chunks(src, dst)  # freeze writes here
    while applied < len(src.log):
        dst.apply(src.log[applied])
        applied += 1
    print(f"snapshot + log: {start} entries behind after the bulk copy, caught up in {ticks} ticks, lag at the freeze {lag}")
    print(f"checksums: {before} chunks differ at the freeze, {bad_chunks(src, dst)} after the last entries; rows diverged {diverged(src, dst)}")
    if diverged(src, dst) != 0 or bad_chunks(src, dst) != 0:
        sys.exit(1)
    clash = sum(1 for k in range(CLASH_PROBE) if snap_next + k in src.rows)
    dst.next_id = src.next_id + ID_GAP  # leave a gap, so new ids never meet ids the old database handed out
    print(f"ids: restarting at {snap_next} collides with {clash} live rows; restarting at {dst.next_id} collides with 0")
    if clash == 0:
        sys.exit(1)
    dst.log = []
    workload(dst, WRITES_AFTER_FLIP)  # the flip happened; the new database takes 200 writes
    if reverse:
        for e in dst.log:
            src.apply(e)  # reverse replication keeps the old database current
    lost = 0 if reverse else len(dst.log)
    print(f"rollback {'with' if reverse else 'without'} reverse replication: {lost} writes lost, rows diverged {diverged(src, dst)}")
    return lost, diverged(src, dst)


a, b = migrate(True), migrate(False)
if a[0] != 0 or a[1] != 0 or b[0] == 0 or b[1] == 0:
    sys.exit(1)
