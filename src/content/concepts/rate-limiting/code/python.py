"""A token bucket rate limiter in Python. The clock is passed in so the demo is deterministic."""


class TokenBucket:
    def __init__(self, capacity, refill_per_second, now):
        self.capacity = capacity
        self.refill_per_second = refill_per_second
        self.now = now
        self._tokens = capacity  # start full, so a new client can burst
        self._last = now()

    def try_take(self):
        t = self.now()
        # add the tokens earned since the last call, but never beyond the capacity
        self._tokens = min(self.capacity, self._tokens + (t - self._last) * self.refill_per_second)
        self._last = t
        if self._tokens >= 1:
            self._tokens -= 1
            return True
        return False


time = 0  # seconds, moved by hand
bucket = TokenBucket(3, 1, lambda: time)


def request(label):
    print(f"t={time}s {label}: {'allowed' if bucket.try_take() else '429 too many requests'}")


for r in ["r1", "r2", "r3", "r4"]:  # a burst of 4 at once: the 4th is rejected
    request(r)
time = 1
request("r5")  # one second later one token has refilled
request("r6")  # but only one
time = 10
for r in ["r7", "r8", "r9", "r10"]:  # a long pause refills only up to the capacity (3)
    request(r)
