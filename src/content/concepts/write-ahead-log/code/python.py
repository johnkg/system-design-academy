# A mini database with a write-ahead log: log first, lazy page writes, crash, then analysis / redo / undo.
# Records are (lsn, kind, tx, page, delta, ref). For a ckpt_end record ref is the LSN where its checkpoint began;
# for a clr (compensation) record ref is the LSN of the update it undoes.


class Db:
    def __init__(self, balances):
        self.disk = {p: [b, 0] for p, b in enumerate(balances)}  # page -> [balance, pageLSN]
        self.pool = {}      # buffer pool: cached, possibly dirty pages
        self.log = []       # the log, including a not yet durable tail
        self.flushed = 0    # log[:flushed] has been fsynced
        self.fsyncs = 0

    def append(self, kind, tx, page=-1, delta=0, ref=0):
        lsn = len(self.log) + 1
        self.log.append((lsn, kind, tx, page, delta, ref))
        return lsn

    def flush(self):
        if len(self.log) > self.flushed:
            self.flushed = len(self.log)
            self.fsyncs += 1

    def update(self, tx, page, delta):
        lsn = self.append("update", tx, page, delta)              # 1. describe the change in the log
        if page not in self.pool:
            self.pool[page] = list(self.disk[page])
        self.pool[page][0] += delta                               # 2. then change the cached page
        self.pool[page][1] = lsn                                  # pageLSN = LSN of the last change

    def commit(self, tx):
        self.append("commit", tx)
        self.flush()                                              # committed = commit record is durable

    def evict(self, page, obey_wal):                              # steal: write a page that may be uncommitted
        if obey_wal:
            self.flush()                                          # write-ahead rule: log reaches disk first
        self.disk[page] = self.pool.pop(page)

    def checkpoint(self):
        begin = self.append("ckpt_begin", 0)
        self.flush()
        for page in sorted(self.pool):
            self.disk[page] = self.pool.pop(page)
        self.append("ckpt_end", 0, ref=begin)
        self.flush()

    def crash(self):                                              # power loss: pool and log tail vanish
        return {p: list(v) for p, v in self.disk.items()}, self.log[: self.flushed]


def recover(disk, log):
    log = list(log)
    start, state = 1, {}
    for r in log:
        if r[1] == "ckpt_end":
            start = r[5]                                          # newest complete checkpoint
    scanned = [r for r in log if r[0] >= start]
    for r in scanned:                                             # analysis: who was still running?
        if r[1] in ("update", "clr"):
            state.setdefault(r[2], "active")
        elif r[1] == "commit":
            state[r[2]] = "committed"
    losers = sorted(t for t, s in state.items() if s == "active")
    redone = skipped = 0
    for r in scanned:                                             # redo: repeat history from the checkpoint
        if r[1] in ("update", "clr"):
            if disk[r[3]][1] < r[0]:                              # page older than the record? apply it
                disk[r[3]][0] += r[4]
                disk[r[3]][1] = r[0]
                redone += 1
            else:
                skipped += 1
    done = {r[5] for r in log if r[1] == "clr"}
    undone = 0
    for r in reversed(log):                                       # undo losers, newest change first
        if r[1] == "update" and r[2] in losers and r[0] not in done:
            lsn = log[-1][0] + 1
            log.append((lsn, "clr", r[2], r[3], -r[4], r[0]))     # the undo is itself logged
            disk[r[3]][0] -= r[4]
            disk[r[3]][1] = lsn
            undone += 1
    return len(scanned), redone, skipped, losers, undone


def scenario(obey_wal):
    db = Db([100, 100, 100, 100])
    db.update(1, 0, -30); db.update(1, 1, 30); db.commit(1)       # T1: page 0 -> page 1, $30
    db.checkpoint()
    db.update(2, 2, -20); db.update(2, 3, 20); db.commit(2)       # T2 commits, its pages stay in the pool
    db.update(3, 0, -10); db.update(3, 2, 10); db.commit(3)       # T3 commits too
    db.update(4, 1, -50)                                          # T4 debits page 1 ...
    db.evict(1, obey_wal)                                         # ... the pool steals that dirty page ...
    disk, log = db.crash()                                        # ... and the power fails before T4 commits
    on_disk = ",".join(str(disk[p][0]) for p in range(4))
    scanned, redone, skipped, losers, undone = recover(disk, log)
    final = [disk[p][0] for p in range(4)]
    print(f"obey write-ahead rule: {'true' if obey_wal else 'false'}")
    print(f"  durable log {len(log)} records, fsyncs {db.fsyncs}, pages on disk at crash [{on_disk}]")
    print(f"  analysis scanned {scanned}, losers {losers}; redo applied {redone} skipped {skipped}; undo {undone}")
    print(f"  recovered [{','.join(str(b) for b in final)}] total {sum(final)}")
    return final


good = scenario(True)
assert good == [60, 130, 90, 120], good                           # T1+T2+T3 survive, T4 is gone
bad = scenario(False)
assert bad == [60, 80, 90, 120], bad                              # T4's debit leaked: no log record to undo it
assert sum(bad) == 350 and sum(good) == 400
print("committed data survived; uncommitted data vanished only with the write-ahead rule")
