# An offline-first sync engine in Python:
# each device keeps a local copy and an outbox, the server merges field by field (newest write wins), and a device that stayed away too long starts again from a snapshot.

FIELDS = ['title', 'done', 'note']


def newer(a, b):
    """A write is a dict with mid, id, field, v, ts, dev. The newer write to a field wins; equal timestamps are settled by the device name."""
    return a['ts'] > b['ts'] or (a['ts'] == b['ts'] and a['dev'] > b['dev'])


def merge(fields, w):
    cur = fields.get(w['field'])
    if cur is None or newer(w, cur):
        fields[w['field']] = {'v': w['v'], 'ts': w['ts'], 'dev': w['dev']}


def gone(f):  # a delete is just another field: a tombstone
    return '_gone' in f and f['_gone']['v'] == 1


class Server:
    def __init__(self):
        self.recs, self.seq, self.floor, self.seen, self.dups = {}, 0, 0, set(), 0

    def push(self, muts):
        for m in muts:
            if m['mid'] in self.seen:  # a retried mutation is acknowledged but not applied again
                self.dups += 1
                continue
            self.seen.add(m['mid'])
            r = self.recs.setdefault(m['id'], {'f': {}, 'seq': 0})
            merge(r['f'], m)
            self.seq += 1
            r['seq'] = self.seq

    def pull(self, cursor):
        reset = cursor < self.floor  # the tombstones this device needs were already collected
        recs = [(i, r['f']) for i, r in self.recs.items() if reset or r['seq'] > cursor]
        return reset, recs, self.seq

    def compact(self, horizon):  # forget tombstones older than the horizon
        dead = [i for i, r in self.recs.items() if gone(r['f']) and r['seq'] <= horizon]
        for i in dead:
            del self.recs[i]
        self.floor = horizon
        return len(dead)


class Client:
    def __init__(self, dev, skew, server, log):
        self.dev, self.skew, self.server, self.log = dev, skew, server, log
        self.db, self.outbox, self.cursor, self.n, self.last = {}, [], 0, 0, 0

    def fields(self, i):
        return self.db.setdefault(i, {})

    def write(self, i, field, v, wall):
        ts = max(wall + self.skew, self.last + 1)  # never behind anything this device has seen
        self.last = ts
        self.n += 1
        w = {'mid': f'{self.dev}-{self.n}', 'id': i, 'field': field, 'v': v, 'ts': ts, 'dev': self.dev}
        merge(self.fields(i), w)
        self.outbox.append(w)
        self.log.append(w)

    def sync(self, retry):
        self.server.push(self.outbox)
        if retry:
            self.server.push(self.outbox)  # the reply was lost, so the client sends the same batch again
        self.outbox = []
        reset, recs, cursor = self.server.pull(self.cursor)
        if reset:
            self.db = {}
        for i, f in recs:
            for field, c in f.items():
                merge(self.fields(i), {'field': field, 'v': c['v'], 'ts': c['ts'], 'dev': c['dev']})
                self.last = max(self.last, c['ts'])
        self.cursor = cursor
        return reset


def view(recs):
    parts = []
    for i in sorted(i for i, f in recs.items() if not gone(f)):
        f = recs[i]
        parts.append(f"{i}:" + '/'.join(str(f[k]['v']) if k in f else '-' for k in FIELDS))
    return ' '.join(parts)


def checksum(s):
    h = 7
    for ch in s:
        h = (h * 31 + ord(ch)) % 1000000007
    return h


SEED, STEPS, ROWS, DELETE_PCT, MAX_VALUE = 99, 600, 12, 4, 100
START_MS, STEP_MS, B_SKEW_MS = 5000000, 1000, -10 * 60 * 1000  # B's clock is 10 minutes slow
SYNC_EVERY, RETRY_ONE_IN = 7, 4  # a device syncs every 7 steps; 1 sync in 4 also re-sends its last push
C_SYNC_AT, COMPACT_AT, COMPACT_KEEP = 100, 400, 100  # compaction keeps the last 100 changes
seed = SEED


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


server, log = Server(), []
A, B, C = Client('A', 0, server, log), Client('B', B_SKEW_MS, server, log), Client('C', 0, server, log)  # B's clock is 10 minutes slow
edits = deletes = removed = ghosts = 0
for step in range(STEPS):
    d = rnd(2)
    c = [A, B][d]
    i, kind, wall = rnd(ROWS), rnd(100), START_MS + step * STEP_MS
    if not (i in c.db and gone(c.db[i])):  # a deleted row is not on screen, so it cannot be edited
        if kind < DELETE_PCT:
            c.write(i, '_gone', 1, wall)
            deletes += 1
        else:
            c.write(i, FIELDS[rnd(3)], rnd(MAX_VALUE), wall)
            edits += 1
    if step % SYNC_EVERY == d:
        c.sync(rnd(RETRY_ONE_IN) == 0)
    if step == C_SYNC_AT:
        C.sync(False)  # C syncs once and then stays offline
    if step == COMPACT_AT:
        removed = server.compact(server.seq - COMPACT_KEEP)
before = [i for i, f in C.db.items() if not gone(f)]
A.sync(False)
B.sync(False)
was_reset = C.sync(False)
A.sync(False)
B.sync(False)
for i in before:
    if i not in C.db or gone(C.db[i]):
        ghosts += 1

truth = {}  # the same writes merged in one pass, to check against
for w in log:
    merge(truth.setdefault(w['id'], {}), w)
views = [view(x) for x in (A.db, B.db, C.db, {i: r['f'] for i, r in server.recs.items()}, truth)]
agree = all(v == views[0] for v in views)
print(f'{edits} edits and {deletes} deletes on 2 live devices; duplicate pushes ignored: {server.dups}')
print(f'compaction at seq {server.floor} removed {removed} tombstones; {len(server.recs)} records remain')
print(f"device C was offline from step 100: reset {'true' if was_reset else 'false'}, deleted rows it still showed: {ghosts}")
print(f"all devices, server and the one-pass merge agree: {'true' if agree else 'false'}; checksum {checksum(views[0])}")
assert agree and was_reset and server.dups > 0
