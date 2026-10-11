# Change data capture in miniature, in Python:
# a table that appends every change to a log, a connector that reads the log with committed offsets and crashes once,
# an idempotent sink, and a polling copy for comparison. Values are positive, and 0 means "no row".
import sys

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


table = {}  # key -> (value, updated_at)
log = []    # the source's write-ahead log: one entry per committed change, in order


def write(op, key, value):
    before = table[key][0] if key in table else 0
    lsn = len(log) + 1
    if op == "delete":
        del table[key]
    else:
        table[key] = (value, lsn)
    log.append({"lsn": lsn, "op": op, "key": key, "before": before, "after": 0 if op == "delete" else value})


# Polling by updated_at: it copies rows changed since its cursor, and a deleted row is simply not there to be found.
polled = {}
cursor = 0


def poll():
    global cursor
    for key, (value, updated_at) in table.items():
        if updated_at > cursor:
            polled[key] = value
    cursor = len(log)


for i in range(400):  # 400 changes to 25 keys
    key = random(25)
    if key not in table:
        write("insert", key, 1 + random(1000))
    elif random(10) < 2:
        write("delete", key, 0)
    else:
        write("update", key, 1 + random(1000))
    if (i + 1) % 50 == 0:
        poll()


class Sink:
    """Keeps the log position of the last change it applied per key, and ignores anything not newer."""

    def __init__(self):
        self.rows = {}
        self.last_lsn = {}
        self.ignored = 0

    def apply(self, e):
        if e["lsn"] <= self.last_lsn.get(e["key"], 0):
            self.ignored += 1
            return
        self.last_lsn[e["key"]] = e["lsn"]  # a delete keeps its position too, so a replayed older insert cannot bring the row back
        if e["op"] == "delete":
            self.rows.pop(e["key"], None)
        else:
            self.rows[e["key"]] = e["after"]


sink = Sink()
delta_total = 0  # a careless sink that adds (after - before) for every event it receives
delivered = committed = batches = 0
crashed = False
while committed < len(log):
    batch = log[committed:committed + 25]
    for e in batch:
        sink.apply(e)
        delta_total += e["after"] - e["before"]
        delivered += 1
    batches += 1
    if batches == 6 and not crashed:  # crash after applying the batch, before committing its offset: restart from the old offset
        crashed = True
        continue
    committed += len(batch)

source_total = sum(v for v, _ in table.values())
ghosts = sum(1 for k in polled if k not in table)
same_rows = len(table) == len(sink.rows) and all(sink.rows.get(k) == v for k, (v, _) in table.items())
print(f"source: {len(log)} changes, {len(table)} rows, total {source_total}")
print(f"polling copy: {len(polled)} rows, {ghosts} deleted rows still present")
print(f"log-based: {delivered} events delivered for {len(log)} changes, {delivered - len(log)} replayed, {sink.ignored} ignored by the sink")
print(f"idempotent sink matches the source: {str(same_rows).lower()}, total {sum(sink.rows.values())}")
print(f"delta-adding sink total: {delta_total}, off by {delta_total - source_total}")
if not same_rows or ghosts == 0 or sink.ignored != delivered - len(log) or delivered == len(log) or delta_total == source_total:
    sys.exit(1)
