# A miniature of the commit-wait idea in the Spanner paper "Spanner: Google's Globally Distributed Database", in Python
# (a teaching model, not Google's code): TrueTime returns an interval that is certain to contain the true time, a commit picks
# the latest end of that interval as its timestamp, and the commit waits until that timestamp has certainly passed. Without the
# wait, a transaction that starts after another has committed can be given an earlier timestamp. A snapshot read then reads
# the newest version at or below a timestamp, but only on a replica whose safe time has reached it.
# Everything is deterministic, so every run prints the same thing. All times are whole milliseconds and all numbers are made up.
import sys

EPSILON = 12  # the uncertainty TrueTime advertises: every clock is within this of the true time
OFFSET_A = 10  # coordinator A's clock runs this far ahead of true time
OFFSET_B = -10  # coordinator B's clock runs this far behind: the two are 20 apart, within twice EPSILON
PAXOS_MS = 5  # time for a Paxos commit


# TrueTime on a machine whose clock is `offset` ahead of true time `t`.
def now(t, offset):
    return {"earliest": t + offset - EPSILON, "latest": t + offset + EPSILON}


def after(t, offset, stamp):
    return now(t, offset)["earliest"] > stamp  # true when stamp has definitely passed


# T1 reaches coordinator A at true time 100 and takes the latest end of its interval as its commit timestamp.
def commit_first(commit_wait):
    arrival = 100
    stamp = now(arrival, OFFSET_A)["latest"]
    visible = arrival + PAXOS_MS  # when Paxos has finished
    if commit_wait:
        while not after(visible, OFFSET_A, stamp):  # commit wait: nobody may see T1 until its stamp is in the past
            visible += 1
    return {"stamp": stamp, "visible": visible}


# T2 starts the moment T1 is visible and reaches coordinator B, whose clock is behind.
def commit_second(starts_at):
    return now(starts_at, OFFSET_B)["latest"]


def ordering(commit_wait):
    print(f"--- {'with' if commit_wait else 'without'} commit wait")
    first = commit_first(commit_wait)
    second = commit_second(first["visible"])
    preserved = second > first["stamp"]
    print(f"T1 timestamp {first['stamp']}, visible to clients at {first['visible']}")
    verdict = "ordered after T1" if preserved else "ordered BEFORE T1, external consistency broken"
    print(f"T2 starts at {first['visible']}, timestamp {second}: {verdict}")
    return {"preserved": preserved, "first": first, "second": second}


# A versioned row: each write is stored at its commit timestamp. A snapshot read takes the newest version at or below its timestamp.
versions = [{"at": 50, "value": 10}]


def snapshot_read(read_at, replica_safe_time):
    if read_at > replica_safe_time:
        return f"waits: this replica is only up to date to {replica_safe_time}"
    hit = [v for v in versions if v["at"] <= read_at][-1]
    return f"reads {hit['value']} (the version written at {hit['at']}), no locks"


without_wait = ordering(False)
with_wait = ordering(True)
versions.append({"at": with_wait["first"]["stamp"], "value": 20})
versions.append({"at": with_wait["second"], "value": 30})

print("--- lock-free snapshot reads")
for read_time in [100, with_wait["first"]["stamp"], with_wait["second"]]:
    print(f"read at {read_time}, replica up to date to {with_wait['second']}: {snapshot_read(read_time, with_wait['second'])}")
print(f"read at {with_wait['second']}, replica up to date to {with_wait['first']['stamp']}: {snapshot_read(with_wait['second'], with_wait['first']['stamp'])}")
ok = not without_wait["preserved"] and with_wait["preserved"] and with_wait["second"] > with_wait["first"]["stamp"]
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
