# Keyed counters with checkpoints: state + input offset are snapshotted together, a crash restores both and replays.
import sys

N, KEYS, OPS, CRASH, COMMIT_EVERY = 600, 12, 3, 330, 120
SEED, SKEW_STEPS = 12345, 1000  # r in 0..999 is squared, so low keys are hot
KEY_GROUPS = 12
SHORT_INTERVAL, LONG_INTERVAL = 50, 200  # checkpoint intervals, in events

# Seeded orders stream: event i is "customer k placed an order"; low ids are the busy customers.
EVENTS = []
x = SEED
for i in range(N):
    # Park-Miller "minimal standard" LCG (MINSTD).
    x = (x * 48271) % 2147483647
    r = x % SKEW_STEPS
    EVENTS.append((r * r * KEYS) // (SKEW_STEPS * SKEW_STEPS))


# key -> key group -> operator instance: each key lives on exactly one instance.
def op_of(k):
    return (((k * 7 + 2) % KEY_GROUPS) * OPS) // KEY_GROUPS


class Sink:
    def __init__(self, kind):
        self.kind, self.records, self.pending = kind, [], []
        self.table, self.writes = [0] * KEYS, 0

    def emit(self, off, k, count):
        if self.kind == "plain":
            self.records.append(off)
        elif self.kind == "idempotent":
            self.table[k] = count  # keyed upsert
            self.writes += 1
        else:
            self.pending.append(off)  # transactional: held in an open transaction

    def commit(self):  # checkpoint completed
        self.records.extend(self.pending)
        self.pending = []

    def abort(self):
        n = len(self.pending)
        self.pending = []
        return n


def run(interval, kind, separate):
    sink = Sink(kind)
    zero = lambda: [[0] * KEYS for _ in range(OPS)]
    copy = lambda s: [a[:] for a in s]
    ops = zero()
    snap_ops, snap_off = zero(), 0

    def process(off):
        k = EVENTS[off]
        o = op_of(k)
        ops[o][k] += 1
        sink.emit(off, k, ops[o][k])

    for off in range(CRASH):
        process(off)
        if interval > 0 and (off + 1) % interval == 0:
            snap_ops, snap_off = copy(ops), off + 1
            sink.commit()
    aborted = sink.abort()  # crash: the open transaction is rolled back, memory is gone
    restore = (CRASH // COMMIT_EVERY) * COMMIT_EVERY if separate else snap_off
    ops = copy(snap_ops)
    for off in range(restore, CRASH):
        process(off)
    sink.commit()
    truth = [0] * KEYS
    for i in range(CRASH):
        truth[EVENTS[i]] += 1
    wrong = sum(1 for k in range(KEYS) if ops[op_of(k)][k] != truth[k])
    dup = missing = extra = 0
    if kind == "idempotent":
        rows = sum(1 for c in sink.table if c > 0)
        extra = sink.writes - CRASH
    else:
        rows = len(sink.records)
        dup = rows - len(set(sink.records))
        missing = CRASH - len(set(sink.records))
        extra = aborted
    r = dict(restore=restore, replayed=CRASH - restore, lost=max(0, restore - snap_off), double=max(0, snap_off - restore),
             wrong=wrong, rows=rows, dup=dup, missing=missing, extra=extra)
    print(f"i={interval} {kind} separate={str(separate).lower()} restore={r['restore']} replayed={r['replayed']} lost={r['lost']} "
          f"double={r['double']} wrong_keys={r['wrong']} rows={r['rows']} dup={r['dup']} missing={r['missing']} extra={r['extra']}")
    return r


def must(c, m):
    if not c:
        print("FAILED: " + m)
        sys.exit(1)


for i in (0, SHORT_INTERVAL, LONG_INTERVAL):
    must(run(i, "plain", False)["wrong"] == 0, "state exact with checkpoints")
idem = run(SHORT_INTERVAL, "idempotent", False)
tx = run(SHORT_INTERVAL, "transactional", False)
run(LONG_INTERVAL, "transactional", False)
plain = run(SHORT_INTERVAL, "plain", False)
must(plain["dup"] == 30 and plain["replayed"] == 30, "plain sink repeats the replayed outputs")
must(idem["dup"] == 0 and idem["extra"] == 30 and idem["wrong"] == 0, "upsert absorbs the replay")
must(tx["dup"] == 0 and tx["missing"] == 0 and tx["extra"] == 30, "2PC sink: no duplicates, open transaction aborted")
behind, ahead = run(SHORT_INTERVAL, "plain", True), run(LONG_INTERVAL, "plain", True)
must(behind["double"] == 60 and behind["wrong"] > 0, "offset committed separately, behind the state: double counting")
must(ahead["lost"] == 40 and ahead["wrong"] > 0, "offset committed separately, ahead of the state: lost events")
print("ok")
