# A bulk import in Python: a resumable chunked upload, row-by-row validation with an error report,
# an idempotent re-run, and a fair scheduler that stops one big tenant from starving small ones.
import re, sys

SEED = 7
seed = SEED

def rand(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n

CHUNK = 8
ROWS, MAX_QTY = 44, 9
ROW_KINDS = 10  # 1 in 10 rows has a bad email, 1 in 10 a bad quantity

def make_rows(n):
    rows = []
    for i in range(1, n + 1):
        r = rand(ROW_KINDS)
        rows.append(f'{i},bad-email,3' if r == 0 else f'{i},u{i}@x.io,many' if r == 1 else f'{i},u{i}@x.io,{1 + rand(MAX_QTY)}')
    return rows

# The server remembers which chunks arrived, so a client that reconnects only sends the missing ones.
class Upload:
    def __init__(self, total):
        self.total = total
        self.chunks = {}
        self.dupes = 0

    def put(self, i, rows):
        if i in self.chunks:
            self.dupes += 1  # a repeated chunk is ignored
        else:
            self.chunks[i] = rows

    def missing(self):
        return [i for i in range(self.total) if i not in self.chunks]

# Streaming validation: one row at a time, never holding the whole file, and every problem gets its line number.
def validate(upload, on_valid, errors):
    for i in range(upload.total):
        for j, line in enumerate(upload.chunks[i]):
            id_, email, qty = line.split(',')
            at = f'line {i * CHUNK + j + 1}'
            if not re.fullmatch(r'[0-9]+', id_):
                errors.append(f'{at}: id')
            elif '@' not in email:
                errors.append(f'{at}: email')
            elif not re.fullmatch(r'[1-9]', qty):
                errors.append(f'{at}: qty')
            else:
                on_valid({'id': int(id_), 'email': email, 'qty': int(qty)})

# An upsert by natural key: applying the same row again changes nothing, so a re-run is safe.
def apply(store, rec):
    cur = store.get(rec['id'])
    if cur and cur['email'] == rec['email'] and cur['qty'] == rec['qty']:
        return False
    store[rec['id']] = rec
    return True

# The job key is a hash of the content, so submitting the same file twice returns the same job.
def fnv(s):
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h

jobs = {}

def submit(rows):
    key = fnv('\n'.join(rows))
    if key not in jobs:
        jobs[key] = f'job-{len(jobs) + 1}'
    return jobs[key]

# Fair: one chunk per tenant per round. FIFO: the first tenant's queue is drained before the next.
def schedule(queues, fair):
    left, done, tick = dict(queues), {}, 0
    while any(left.values()):
        turn = [n for n in left if left[n] > 0]
        for n in (turn if fair else turn[:1]):  # fair: everyone waiting gets one; FIFO: only the first
            left[n] -= 1
            tick += 1
            if left[n] == 0:
                done[n] = tick
    return ' '.join(f'{n}={done[n]}' for n in queues)

rows = make_rows(ROWS)
up = Upload(-(-len(rows) // CHUNK))
chunk = lambda i: rows[i * CHUNK:(i + 1) * CHUNK]
for i in [0, 1, 2, 1]:  # the connection drops here, and chunk 1 was sent twice
    up.put(i, chunk(i))
gaps = up.missing()
print(f"after the drop the server is missing chunks {','.join(map(str, gaps))} and ignored {up.dupes} repeat")
for i in gaps:
    up.put(i, chunk(i))

store, errors = {}, []
written, again = [0], [0]  # one-item lists so the callbacks can count
validate(up, lambda rec: written.__setitem__(0, written[0] + apply(store, rec)), errors)
print(f'{submit(rows)}: {len(rows)} rows, {written[0]} written, {len(errors)} rejected')
print(f"first errors: {'; '.join(errors[:3])}")

validate(up, lambda rec: again.__setitem__(0, again[0] + apply(store, rec)), [])
print(f"re-run: {again[0]} writes, same job: {'true' if submit(rows) == 'job-1' else 'false'}")

queues = {'A': 30, 'B': 4, 'C': 4}
print(f'finish tick, FIFO: {schedule(queues, False)}')
print(f'finish tick, fair: {schedule(queues, True)}')
if written[0] + len(errors) != len(rows) or again[0] != 0 or len(store) != written[0]:
    sys.exit(1)
