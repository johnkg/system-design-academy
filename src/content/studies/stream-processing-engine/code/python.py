# A tiny stream engine in Python: keyed state, tumbling event-time windows, watermarks,
# checkpoints, and recovery by restoring state and replaying the log. Integers only, so it is deterministic.
import sys

WINDOW, DELAY, EVERY = 10, 4, 50  # window length, watermark lag behind the newest event time, checkpoint interval (events)

KEY_SLOTS = 10  # a state id is window start * 10 + key, so keys must stay below 10
SEED, EVENTS, KEYS, EVENTS_PER_TICK, MAX_LATENESS, MAX_VALUE = 7, 2000, 5, 4, 8, 9
seed = SEED


def rnd(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


events = []
for i in range(EVENTS):  # arrive out of order
    key = rnd(KEYS)
    time = max(0, i // EVENTS_PER_TICK - rnd(MAX_LATENESS))
    value = 1 + rnd(MAX_VALUE)
    events.append((key, time, value))


class Job:
    def __init__(self):
        self.offset = 0
        self.max_time = -1
        self.windows = {}
        self.out = []
        self.late = 0
        self.late_sum = 0

    def fire(self, limit):  # emit every window that ends at or before the watermark, oldest first
        ready = sorted(i for i in self.windows if i // KEY_SLOTS + WINDOW <= limit)
        for i in ready:
            self.out.append((i, self.windows.pop(i)))

    def step(self):
        key, time, value = events[self.offset]
        self.offset += 1
        start = time - (time % WINDOW)
        wid = start * KEY_SLOTS + key  # the state is keyed by (key, window)
        self.max_time = max(self.max_time, time)
        watermark = self.max_time - DELAY
        if start + WINDOW <= watermark:  # its window has already fired
            self.late += 1
            self.late_sum += value
        else:
            self.windows[wid] = self.windows.get(wid, 0) + value
        self.fire(watermark)

    def snapshot(self):
        return (self.offset, self.max_time, dict(self.windows), len(self.out), self.late, self.late_sum)

    def restore(self, s, transactional_sink):
        self.offset, self.max_time, w, out_len, self.late, self.late_sum = s
        self.windows = dict(w)
        if transactional_sink:
            del self.out[out_len:]  # uncommitted output is aborted


def run(crashes, transactional_sink):
    job = Job()
    snap, nxt, replayed = job.snapshot(), 0, 0
    while job.offset < len(events):
        if nxt < len(crashes) and job.offset == crashes[nxt]:
            nxt += 1
            replayed += job.offset - snap[0]
            job.restore(snap, transactional_sink)
            continue
        job.step()
        if job.offset % EVERY == 0:
            snap = job.snapshot()
    job.fire(float("inf"))  # the stream ended: flush what is left
    return job, replayed


def checksum(out):
    h = 0
    for i, s in out:
        h = (h * 131 + i * 1000 + s) % 1000003
    return h


def total_of(j):
    return sum(v for _, v in j.out) + j.late_sum


total = sum(e[2] for e in events)
crashes = [130, 410, 777, 1499]

ref, _ = run([], True)
print(f"no crash: {len(ref.out)} windows, late dropped {ref.late}, checksum {checksum(ref.out)}")
exact, replayed = run(crashes, True)
same = exact.out == ref.out
print(f"4 crashes, transactional sink: replayed {replayed} events, identical output: {'true' if same else 'false'}")
naive, _ = run(crashes, False)
print(f"4 crashes, plain sink: {len(naive.out)} rows, {len(naive.out) - len(ref.out)} duplicates")
print("first rows: " + "; ".join(f"key {i % KEY_SLOTS} @{i // KEY_SLOTS} = {v}" for i, v in ref.out[:3]))

if not same or total_of(ref) != total or total_of(exact) != total or len(naive.out) <= len(ref.out):
    sys.exit(1)
