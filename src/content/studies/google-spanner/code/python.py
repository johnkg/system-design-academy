# A miniature of TrueTime and commit wait from Google's Spanner paper (OSDI 2012), in Python (a teaching model, not Google's code).
# Each server's clock may be off by a few milliseconds, but the clock API returns an interval that is guaranteed to hold the true time.
# A write takes the latest end of that interval as its timestamp and, with commit wait, tells the client "done" only once that
# timestamp is certainly in the past. Without the wait, a write that starts after another one has finished can get an earlier timestamp.
# All times are whole milliseconds and everything is deterministic.

EPSILON = 4  # uncertainty in ms; the paper says it is about 4 ms most of the time and generally under 10 ms
SKEW = {"X": 3, "Y": -3}  # how far each server's local clock is from true time (always within EPSILON)


def now(server, true_time):  # TT.now(): an interval that is guaranteed to contain the true time
    local = true_time + SKEW[server]
    return local - EPSILON, local + EPSILON  # earliest, latest


def write(versions, server, start_true, value, wait):
    ts = now(server, start_true)[1]  # commit timestamp: no earlier than TT.now().latest
    ack_true = start_true
    if wait:
        while not now(server, ack_true)[0] > ts:  # commit wait: until TT.after(ts) is true
            ack_true += 1
    versions.append((ts, value))
    return ts, ack_true


def scenario(wait):
    print(f"--- commit wait {'on' if wait else 'off'}, uncertainty +/-{EPSILON} ms")
    versions = []
    ts1, ack1 = write(versions, "X", 100, "x=1", wait)
    print(f'T1 on server X starts at 100, gets timestamp {ts1}, client told "done" at {ack1} (waited {ack1 - 100} ms)')
    ts2, _ = write(versions, "Y", ack1 + 1, "x=2", wait)
    print(f"T2 on server Y starts at {ack1 + 1}, after T1 finished, and gets timestamp {ts2}")
    print("timestamps follow real time: external consistency holds" if ts2 > ts1
          else "T2 started after T1 finished but has the EARLIER timestamp: external consistency broken")
    return versions


def snapshot_read(versions, at):  # newest version at or before the timestamp, no locks
    seen = sorted((v for v in versions if v[0] <= at), key=lambda v: -v[0])
    print(f"snapshot read at {at}: {seen[0][1] if seen else 'nothing yet'}")


scenario(False)
versions = scenario(True)
print("--- snapshot reads of the second run need no locks")
for at in [106, 107, 110, 111]:
    snapshot_read(versions, at)
