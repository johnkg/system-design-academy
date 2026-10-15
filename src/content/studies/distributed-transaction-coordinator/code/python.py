# Two-phase commit with a durable coordinator log and presumed abort, in Python:
# participants lock and promise in phase one, the coordinator logs COMMIT before telling anyone,
# and after a crash the in-doubt participants ask the coordinator, which answers "abort" when its log has no commit record.
import sys


class Shard:
    def __init__(self, name, balance):
        self.name = name
        self.balance = balance
        self.lock = None
        self.pending = 0

    def prepare(self, tx, delta):  # phase 1: take the lock and promise, or refuse
        if self.lock == tx:
            return "yes"
        if self.lock is not None:
            return f"no (locked by {self.lock})"
        if self.balance + delta < 0:
            return "no (insufficient funds)"
        self.lock = tx
        self.pending = delta  # in a real system this "prepared" record is forced to disk before replying
        return "yes"

    def commit(self, tx):  # repeating it is harmless
        if self.lock == tx:
            self.balance += self.pending
            self.lock = None
            self.pending = 0

    def abort(self, tx):
        if self.lock == tx:
            self.lock = None
            self.pending = 0


class Coordinator:
    def __init__(self, shards):
        self.shards = shards
        self.log = []  # the log survives a crash, nothing else does

    def run(self, tx, deltas, crash_at):
        prepared = []
        for name, delta in deltas:
            shard = self.shards[name]
            vote = shard.prepare(tx, delta)
            prepared.append(shard)
            if vote != "yes":  # presumed abort: nothing is logged, a missing commit record means abort
                for s in prepared:
                    s.abort(tx)
                return f"{tx} aborted: {name} voted {vote}"
        if crash_at == "before-decision":
            return f"{tx} coordinator crashed before logging a decision"
        self.log.append(f"commit {tx}")  # the decision point: forced to disk before any shard hears of it
        if crash_at == "after-decision":
            return f"{tx} coordinator crashed after logging commit"
        for i, shard in enumerate(prepared):
            shard.commit(tx)
            if crash_at == "mid-commit" and i == 0:
                return f"{tx} coordinator crashed after telling {shard.name}"
        self.log.append(f"end {tx}")
        return f"{tx} committed"

    def outcome(self, tx):  # presumed abort
        return "commit" if f"commit {tx}" in self.log else "abort"

    def recover(self):
        finished = []
        for shard in self.shards.values():
            if shard.lock is None:
                continue
            tx = shard.lock
            answer = self.outcome(tx)
            if answer == "commit":
                shard.commit(tx)
                if tx not in finished:
                    finished.append(tx)
            else:
                shard.abort(tx)
            print(f"  {shard.name} was in doubt about {tx}, coordinator says {answer}")
        for tx in finished:
            if f"end {tx}" not in self.log:
                self.log.append(f"end {tx}")


shards = {"A": Shard("A", 100), "B": Shard("B", 100), "C": Shard("C", 100)}
coordinator = Coordinator(shards)


def show():
    held = ",".join(f"{s.name}:{s.lock}" for s in shards.values() if s.lock)
    print(f"  {' '.join(f'{s.name}={s.balance}' for s in shards.values())} locks=[{held}]")


def total():
    return sum(s.balance for s in shards.values())


plan = [
    ("tx1", [("A", -30), ("B", 30)], None),
    ("tx2", [("B", -50), ("C", 50)], "before-decision"),
    ("tx3", [("A", -10), ("B", 10)], None),  # B is still locked by the in-doubt tx2
    ("recover", None, None),
    ("tx4", [("A", -20), ("C", 20)], "after-decision"),
    ("recover", None, None),
    ("tx5", [("C", -40), ("B", 40)], "mid-commit"),
    ("recover", None, None),
    ("tx6", [("A", -500), ("C", 500)], None),
]
for tx, deltas, crash_at in plan:
    if tx == "recover":
        print("  coordinator restarts and recovers")
        coordinator.recover()
    else:
        print(coordinator.run(tx, deltas, crash_at))
    show()
print(f"log: {', '.join(coordinator.log)}")
clean = all(s.lock is None for s in shards.values())
print(f"money total {total()}, all locks released: {'true' if clean else 'false'}")
if total() != 300 or not clean or any(r.startswith("abort") for r in coordinator.log):
    sys.exit(1)
