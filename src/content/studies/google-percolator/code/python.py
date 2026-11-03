# A miniature of Percolator's transactions from Google's OSDI 2010 paper, in Python (a teaching model, not Google's code):
# every cell has data, lock and write columns indexed by timestamp, a timestamp oracle hands out increasing numbers, a
# transaction reads at its start timestamp, commits with two-phase commit in which one cell's write record is the commit point,
# and a reader that meets a lock left by a crashed transaction rolls it back or forward by looking at the primary lock.
# The example is the paper's: moving $7 from Bob ($10) to Joe ($2). Everything is deterministic.

oracle = [0]
rows = {}  # row -> {"data": {ts: value}, "lock": {ts: "primary" | "secondary of <row>"}, "write": {ts: data timestamp}}


def next_ts():
    oracle[0] += 1
    return oracle[0]


def cell(row):
    return rows.setdefault(row, {"data": {}, "lock": {}, "write": {}})


def seed(row, value):
    s, c = next_ts(), next_ts()
    cell(row)["data"][s] = value
    cell(row)["write"][c] = s


def fmt(d):
    return "{" + " ".join(f"{k}:{d[k]}" for k in sorted(d)) + "}"


def show(label):
    print(label)
    for r in rows:
        c = rows[r]
        print(f"  {r}: data {fmt(c['data'])}  lock {fmt(c['lock'])}  write {fmt(c['write'])}")


def latest_write(row, ts):  # newest commit timestamp at or below ts, and the data timestamp it points to
    ks = sorted((k for k in cell(row)["write"] if k <= ts), reverse=True)
    return (ks[0], cell(row)["write"][ks[0]]) if ks else None


def get(row, ts):
    locked = [k for k in cell(row)["lock"] if k <= ts]
    if locked:
        return {"blocked": min(locked)}  # a lock at or below our timestamp: the writer may still commit below it
    w = latest_write(row, ts)
    return {"value": cell(row)["data"][w[1]] if w else None}


def prewrite(row, value, start_ts, primary):
    c = cell(row)
    if any(k >= start_ts for k in c["write"]):
        return "conflict: a later commit exists"
    if c["lock"]:
        return "conflict: the cell is locked"
    c["data"][start_ts] = value
    c["lock"][start_ts] = "primary" if row == primary else f"secondary of {primary}"
    return "ok"


def commit_cell(row, start_ts, commit_ts):
    c = cell(row)
    c["write"][commit_ts] = start_ts
    c["lock"].pop(start_ts, None)


def transfer(src, dst, amount, crash_after=None):  # "crash_after" stops the transaction at a chosen point
    start_ts = next_ts()
    a, b = get(src, start_ts)["value"], get(dst, start_ts)["value"]
    results = [prewrite(src, a - amount, start_ts, src), prewrite(dst, b + amount, start_ts, src)]
    bad = [r for r in results if r != "ok"]
    if bad:
        for r in (src, dst):
            cell(r)["lock"].pop(start_ts, None)
            cell(r)["data"].pop(start_ts, None)
        return {"start": start_ts, "outcome": f"aborted ({bad[0]})"}
    if crash_after == "prewrite":
        return {"start": start_ts, "outcome": "crashed after the prewrite, locks left behind"}
    commit_ts = next_ts()
    commit_cell(src, start_ts, commit_ts)  # the primary's write record is the commit point
    if crash_after == "primary":
        return {"start": start_ts, "outcome": "crashed after committing the primary, the secondary lock is left"}
    commit_cell(dst, start_ts, commit_ts)
    return {"start": start_ts, "outcome": f"committed at {commit_ts}"}


def resolve(row):
    # A reader that meets a lock decides what to do from the primary cell. (Real Percolator does this only when the lock's owner is
    # judged dead, after a wait; here the owner has crashed.)
    lock_ts = list(cell(row)["lock"])[0]
    kind = cell(row)["lock"][lock_ts]
    primary = row if kind == "primary" else kind.replace("secondary of ", "")
    if lock_ts in cell(primary)["lock"]:  # the primary is still locked: the transaction never committed
        cell(primary)["lock"].pop(lock_ts)
        cell(primary)["data"].pop(lock_ts, None)
        if row != primary:
            cell(row)["lock"].pop(lock_ts)
            cell(row)["data"].pop(lock_ts, None)
        return f"rolled back the transaction that started at {lock_ts}"
    commit = next(c for c, s in cell(primary)["write"].items() if s == lock_ts)
    commit_cell(row, lock_ts, commit)  # the primary committed: finish the secondary
    return f"rolled forward the transaction that started at {lock_ts}, committed at {commit}"


def read(row, ts):
    r = get(row, ts)
    if "blocked" in r:
        print(f"  reading {row} at {ts} meets a lock from {r['blocked']}: {resolve(row)}")
        r = get(row, ts)
    return r["value"]


seed("Bob", 10)
seed("Joe", 2)
show("--- before: Bob has 10 and Joe has 2")
t = transfer("Bob", "Joe", 7)
print(f"transfer of 7: {t['outcome']}")
show("--- after the commit")
old_bob, old_joe = read("Bob", t["start"]), read("Joe", t["start"])
ts_new = next_ts()
print(f"a reader with timestamp {t['start']} sees Bob {old_bob}, Joe {old_joe}; one with timestamp {ts_new} sees Bob {read('Bob', ts_new)}, Joe {read('Joe', ts_new)}")

print("--- two transfers that overlap")
first = next_ts()  # both read before either commits
x = prewrite("Bob", 0, first, "Bob")
y = prewrite("Bob", 0, first + 1, "Bob")
print(f"first prewrite of Bob: {x}; second prewrite of Bob: {y}")
cell("Bob")["lock"].pop(first, None)
for k in (first, first + 1):
    cell("Bob")["data"].pop(k, None)

print("--- a transaction crashes after the prewrite")
t = transfer("Bob", "Joe", 1, "prewrite")
print(f"transfer of 1: {t['outcome']}")
print(f"  a reader gets: Joe {read('Joe', next_ts())}")

print("--- a transaction crashes after committing the primary")
t = transfer("Bob", "Joe", 1, "primary")
print(f"transfer of 1: {t['outcome']}")
print(f"  a reader gets: Joe {read('Joe', next_ts())}")
show("--- final state")
