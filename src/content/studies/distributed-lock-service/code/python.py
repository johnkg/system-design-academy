# A lock service with leases and fencing tokens, in Python:
# a paused holder loses its lease, a new holder gets a higher token, and the storage rejects the old token.
# All times are logical milliseconds, so the run is the same every time.
import sys

TTL = 10000  # lease length
INITIAL_VALUE = 100
RETRY_AFTER = 500  # how long A waits before it takes the lock again


class LockService:
    def __init__(self):
        self.counter = 0
        self.holder = None
        self.expires = 0

    # Returns a fencing token, or 0 when someone else holds a live lease.
    def acquire(self, who, now):
        if self.holder is not None and now < self.expires:
            return 0
        self.holder = who
        self.expires = now + TTL
        self.counter += 1
        return self.counter

    def release(self, who):
        if self.holder == who:
            self.holder = None

    # A failover to an asynchronous replica: the newest grant and counter value were never copied.
    def failover(self):
        self.holder = None
        self.counter -= 1


class Storage:
    def __init__(self, fencing):
        self.fencing = fencing
        self.value = INITIAL_VALUE
        self.max_token = 0

    def accept(self, token):  # the heart of fencing: remember the highest token, refuse any lower one
        if self.fencing and token < self.max_token:
            return False
        self.max_token = max(self.max_token, token)
        return True

    def read(self, token):
        return self.value if self.accept(token) else None

    def write(self, token, v):
        if not self.accept(token):
            return False
        self.value = v
        return True


# Worker A reads, then stalls. Worker B takes the lock and does a full read-modify-write. A then writes.
def run(name, fencing, failover):
    lock, store = LockService(), Storage(fencing)
    token_a = lock.acquire("A", 0)
    seen_by_a = store.read(token_a)                          # A reads 100 at 500 ms
    if lock.acquire("B", 1000) != 0:
        raise RuntimeError("B got a lock that A holds")
    if failover:
        lock.failover()                                      # at 2000 ms
    b_at, a_writes = (2500, 4500) if failover else (10500, 19500)
    token_b = lock.acquire("B", b_at)                        # after the lease expired, or after the failover
    seen_by_b = store.read(token_b)
    store.write(token_b, seen_by_b + 1)                      # B writes 101
    lock.release("B")
    accepted = store.write(token_a, seen_by_a + 1)           # A writes the stale result
    if not accepted:                                         # A learns it lost the lock and starts again
        t = lock.acquire("A", a_writes + RETRY_AFTER)
        store.write(t, store.read(t) + 1)
        lock.release("A")
    print(f"{name}: tokens A={token_a} B={token_b}; stale write {'accepted' if accepted else 'rejected'}; final value {store.value} (expected 102)")
    return store.value


results = [
    run("no fencing           ", False, False),
    run("fencing, consensus   ", True, False),
    run("fencing, redis failover", True, True),
]
print(f"results: {', '.join(str(r) for r in results)}")

# Invariants: without fencing an update is lost; with monotonic tokens nothing is lost; a token counter that goes back defeats fencing.
if results[0] != 101 or results[1] != 102 or results[2] != 101:
    sys.exit(1)
