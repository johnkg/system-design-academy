# A transaction-mode connection pooler with a bounded wait queue, in Python:
# many clients share a few server connections, the excess waits in a first-in first-out queue, and a request that waits too long fails.
# Time moves in whole milliseconds.
import sys

WAIT_LIMIT = 20  # a request that has waited this long is rejected

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


class Pooler:
    def __init__(self, size):
        self.size = size
        self.busy = []
        self.queue = []
        self.max_busy = 0
        self.served = 0
        self.timed_out = 0
        self.waits = []

    # One millisecond: finish queries, drop requests that waited too long, then lend free server connections to the queue in order.
    def tick(self, now, arrivals):
        self.busy = [end for end in self.busy if end > now]
        self.queue.extend({"duration": r["duration"], "arrived": now} for r in arrivals)
        while self.queue and now - self.queue[0]["arrived"] >= WAIT_LIMIT:
            self.queue.pop(0)
            self.timed_out += 1
        while self.queue and len(self.busy) < self.size:
            r = self.queue.pop(0)
            self.busy.append(now + r["duration"])  # the server connection is returned to the pool when the transaction ends
            self.waits.append(now - r["arrived"])
            self.served += 1
        self.max_busy = max(self.max_busy, len(self.busy))


# 300 requests arrive within 100 ms (a burst) and each transaction takes 5 to 15 ms.
def make_burst():
    global seed
    seed = 7
    by_time = [[] for _ in range(100)]
    for i in range(300):
        t = random(100)
        by_time[t].append({"id": i, "duration": 5 + random(11)})
    return by_time


def run(size):
    burst = make_burst()
    pooler = Pooler(size)
    for now in range(400):
        pooler.tick(now, burst[now] if now < 100 else [])
    max_wait = max(pooler.waits)
    avg_wait = sum(pooler.waits) // len(pooler.waits)
    print(f"pool {size:>2}: served {pooler.served}, timed out {pooler.timed_out}, max busy {pooler.max_busy}, max wait {max_wait}, avg wait {avg_wait}")
    if pooler.max_busy > size:
        raise RuntimeError("the pool was exceeded")
    if pooler.served + pooler.timed_out != 300:
        raise RuntimeError("a request was lost")
    return pooler.timed_out


failures = [run(size) for size in (8, 16, 32, 64)]
if any(i > 0 and f > failures[i - 1] for i, f in enumerate(failures)):
    sys.exit(1)  # a bigger pool never rejects more


# Session state under transaction pooling: a client sets a value on its server connection, and a later transaction may land on another one.
def leaks(mode):
    global seed
    seed = 99
    own = {}    # what each client believes it set
    state = {}  # what each server connection holds, keyed by client in session mode and by connection otherwise
    wrong = 0
    for _ in range(300):
        client = random(12)
        conn = f"client{client}" if mode == "session" else f"conn{random(3)}"
        if random(2) == 0:
            state[conn] = client  # SET timezone for this client
            own[client] = True
        elif client in own and state.get(conn) != client:
            wrong += 1  # SHOW timezone sees another client's value
    return wrong


session_wrong, transaction_wrong = leaks("session"), leaks("transaction")
print(f"wrong session state: session mode {session_wrong}, transaction mode {transaction_wrong}")
if session_wrong != 0 or transaction_wrong == 0:
    sys.exit(1)
