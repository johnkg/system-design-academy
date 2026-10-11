# A tiny distributed SQL core, in Python: keys split into ranges, versions stamped by a hybrid logical clock,
# and a transaction that commits across ranges with write intents and a transaction record (two-phase commit).
import sys


class Hlc:  # wall time plus a counter, so timestamps never go backwards and follow causality
    def __init__(self, offset):
        self.offset, self.wall, self.logical = offset, 0, 0  # offset: how far this machine's clock is off

    def now(self, real):
        w = real + self.offset
        if w > self.wall:
            self.wall, self.logical = w, 0
        else:
            self.logical += 1
        return self.wall * 100 + self.logical

    def observe(self, ts):  # a message carries a timestamp
        if ts // 100 > self.wall:
            self.wall, self.logical = ts // 100, ts % 100


class Range:
    def __init__(self, lo, hi):
        self.lo, self.hi, self.cells = lo, hi, {}  # key -> {"versions": [[ts, value]], "intent": None}

    def cell(self, key):
        return self.cells.setdefault(key, {"versions": [], "intent": None})


class Db:
    def __init__(self, max_keys):
        self.ranges, self.records, self.seq, self.max_keys = [Range("", "~")], {}, 0, max_keys

    def range_index(self, key):
        return next(i for i, r in enumerate(self.ranges) if r.lo <= key < r.hi)

    def split(self):  # a range with too many keys is cut at its middle key
        i = 0
        while i < len(self.ranges):
            r = self.ranges[i]
            keys = sorted(r.cells)
            if len(keys) <= self.max_keys:
                i += 1
                continue
            mid = keys[len(keys) >> 1]
            right = Range(mid, r.hi)
            for k in keys:
                if k >= mid:
                    right.cells[k] = r.cells.pop(k)
            r.hi = mid
            self.ranges.insert(i + 1, right)

    def read(self, key, ts, max_offset):
        # Reads a key as of ts. A value stamped inside (ts, ts + max_offset] might have committed before this read began, so the read restarts above it.
        restarts = 0
        while True:
            c = self.ranges[self.range_index(key)].cell(key)
            rec = self.records[c["intent"]["txn"]] if c["intent"] else None
            if rec and rec["status"] == "PENDING":
                return {"blocked": True}
            allv = c["versions"] + ([[rec["ts"], c["intent"]["value"]]] if rec else [])  # a committed intent counts as a version
            seen = [v for v in allv if v[0] <= ts]
            later = [v for v in allv if ts < v[0] <= ts + max_offset * 100]
            if not later:
                return {"value": seen[-1][1] if seen else None, "restarts": restarts}
            ts, max_offset, restarts = later[-1][0], 0, restarts + 1  # restart at the newest uncertain version


class Txn:
    def __init__(self, db, clock, real):
        db.seq += 1
        self.db, self.id, self.ts, self.keys = db, db.seq, clock.now(real), []
        db.records[self.id] = {"status": "PENDING", "ts": self.ts}

    def write(self, key, value):  # phase 1: leave an intent on the key. Another transaction's intent blocks us
        c = self.db.ranges[self.db.range_index(key)].cell(key)
        if c["intent"]:
            return False
        if c["versions"] and c["versions"][-1][0] >= self.ts:
            self.ts = c["versions"][-1][0] + 1  # never write under a newer version
        c["intent"] = {"txn": self.id, "value": value}
        self.keys.append(key)
        return True

    def commit(self):  # the single atomic commit point
        self.db.records[self.id].update(status="COMMITTED", ts=self.ts)

    def resolve(self):  # phase 2, in the background: turn the intents into ordinary versions
        for k in self.keys:
            c = self.db.ranges[self.db.range_index(k)].cell(k)
            c["versions"].append([self.ts, c["intent"]["value"]])
            c["intent"] = None


def js(b):
    return "true" if b else "false"


db, a, b = Db(3), Hlc(0), Hlc(-8)
for i, (k, v) in enumerate([("alice", 100), ("bob", 50), ("carol", 70), ("maria", 100), ("nina", 20), ("zed", 100)]):
    t = Txn(db, a, 1 + i)
    t.write(k, v)
    t.commit()
    t.resolve()
    db.split()
print("ranges after splits: " + " ".join(f"[{r.lo}..{r.hi})" for r in db.ranges))


def total():
    return sum(db.read(k, 999999, 0)["value"] for k in ["alice", "bob", "carol", "maria", "nina", "zed"])


before, setup_ts = total(), 6 * 100

t1 = Txn(db, a, 20)  # move 30 from alice to zed: two keys in two ranges
t1.write("alice", 70)
t1.write("zed", 130)
ranges = {db.range_index(k) for k in t1.keys}
print(f"T1 touched {len(ranges)} ranges, commit timestamp {t1.ts}")
t2 = Txn(db, a, 21)
print(f"T2 write to zed blocked by T1's intent: {js(not t2.write('zed', 1))}")
print(f"reader before T1 commits is blocked: {js(db.read('zed', 3000, 0).get('blocked'))}")
t1.commit()
print(f"reader after the commit point sees zed = {db.read('zed', 3000, 0)['value']}, even before intents are resolved")
t1.resolve()
print(f"snapshot at ts {setup_ts} still sees alice = {db.read('alice', setup_ts, 0)['value']}, zed = {db.read('zed', setup_ts, 0)['value']}")

ts = b.now(22)  # this gateway's clock runs 8 behind, so its read timestamp is below T1's commit timestamp
trusting, careful = db.read("zed", ts, 0), db.read("zed", ts, 10)
print(f"behind clock, read at {ts}: trusting clocks sees {trusting['value']}; with a 10 uncertainty window sees {careful['value']} after {careful['restarts']} restart")
b.observe(t1.ts)
print(f"after a message from T1's gateway, the next timestamp here is {b.now(23)}")
after = total()
print(f"total money before {before}, after {after}")
if before != after or len(ranges) != 2 or trusting["value"] != 100 or careful["value"] != 130 or careful["restarts"] != 1 or b.now(24) <= t1.ts or len(db.ranges) != 3:
    sys.exit(1)
