# Point-in-time recovery in Python: a base backup plus an ordered change log (the WAL archive).
# restore() copies the base, then replays records in LSN order until the target time or LSN.
def clock(t):
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def at(h, m, s=0):
    return h * 3600 + m * 60 + s


def apply(orders, rec):
    _lsn, _ts, op, oid, total = rec
    if op == "delete_all":
        orders.clear()
    else:  # insert and update both set the row
        orders[oid] = total


class Primary:
    def __init__(self):
        self.orders = {}
        self.log = []  # ordered change log: (lsn, ts, op, id, total)

    def do(self, ts, op, oid=0, total=0):
        rec = (len(self.log) + 1, ts, op, oid, total)
        self.log.append(rec)  # log first, then change the table
        apply(self.orders, rec)
        return rec[0]

    def base_backup(self, ts):
        return {"ts": ts, "lsn": len(self.log), "orders": dict(self.orders)}


def restore(base, archive, target_ts=None, target_lsn=None):
    orders = dict(base["orders"])
    expected = base["lsn"] + 1
    last = base["lsn"]
    for rec in archive:
        lsn, ts = rec[0], rec[1]
        if lsn <= base["lsn"]:
            continue  # already contained in the base backup
        if lsn != expected:
            raise ValueError(f"archive gap: expected LSN {expected}, found {lsn}")
        if target_ts is not None and ts > target_ts:
            break
        if target_lsn is not None and lsn > target_lsn:
            break
        apply(orders, rec)
        last = lsn
        expected += 1
    return orders, last


def show(orders):
    return " ".join(f"{k}={orders[k]}" for k in sorted(orders)) or "(empty)"


db = Primary()
for oid, total in [(1, 20), (2, 40), (3, 15)]:
    db.do(at(1, 0), "insert", oid, total)
base = db.base_backup(at(2, 0))  # 02:00 base backup
db.do(at(2, 10), "insert", 4, 30)
db.do(at(9, 30), "insert", 5, 40)
db.do(at(11, 45), "update", 2, 55)
db.do(at(13, 59, 58), "insert", 6, 25)
bad = db.do(at(14, 3), "delete_all")  # the mistake
db.do(at(14, 3, 30), "insert", 7, 35)
archive = db.log
print(f"base backup {clock(base['ts'])} covers up to LSN {base['lsn']}; archive holds LSN {base['lsn'] + 1}..{len(archive)}")
print(f"DELETE without WHERE is LSN {bad} at {clock(archive[bad - 1][1])}")

good, n = restore(base, archive, target_ts=at(14, 3) - 1)
print(f"restore to {clock(at(14, 3) - 1)}: applied through LSN {n}: {show(good)}")
by_lsn, n2 = restore(base, archive, target_lsn=bad - 1)
print(f"restore to LSN {bad - 1}: {show(by_lsn)}")
same = by_lsn == good
print(f"same result by time and by LSN: {str(same).lower()}")
after, _ = restore(base, archive, target_ts=at(14, 3))
print(f"restore to {clock(at(14, 3))}: {show(after)}")
latest, _ = restore(base, archive)
print(f"restore to end of log: {show(latest)}")
print(f"replica (replays everything): {show(db.orders)}")
print(f"base backup only (no archive): {show(base['orders'])}")
try:
    restore(base, [r for r in archive if r[0] != 6])
except ValueError as e:
    print(f"broken archive: {e}")

assert good == {1: 20, 2: 55, 3: 15, 4: 30, 5: 40, 6: 25} and n == bad - 1
assert same and n2 == bad - 1
assert after == {} and latest == {7: 35} and db.orders == latest
assert base["orders"] == {1: 20, 2: 40, 3: 15}
