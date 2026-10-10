# Three rate limiting algorithms in Python, tried on a burst that straddles a window boundary.
# Limit: 10 requests per second. Times are in milliseconds and passed in, so the demo is deterministic.


class FixedWindow:
    def __init__(self, limit, window_ms):
        self.limit = limit
        self.window_ms = window_ms
        self._window = -1
        self._count = 0

    def allow(self, t):
        window = t // self.window_ms
        if window != self._window:  # a new window starts a new count
            self._window = window
            self._count = 0
        if self._count >= self.limit:
            return False
        self._count += 1
        return True


class SlidingWindowLog:
    def __init__(self, limit, window_ms):
        self.limit = limit
        self.window_ms = window_ms
        self._times = []

    def allow(self, t):
        while self._times and self._times[0] <= t - self.window_ms:  # forget old requests
            self._times.pop(0)
        if len(self._times) >= self.limit:
            return False
        self._times.append(t)
        return True


class TokenBucket:
    def __init__(self, capacity, refill_per_second):
        self.capacity = capacity
        self.refill_per_second = refill_per_second
        self._tokens = capacity
        self._last = 0

    def allow(self, t):
        self._tokens = min(self.capacity, self._tokens + ((t - self._last) / 1000) * self.refill_per_second)
        self._last = t
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True


# 10 requests in the last 100 ms of one second, and 10 more in the first 100 ms of the next
times = [2900 + k * 10 for k in range(10)] + [3000 + k * 10 for k in range(10)]


def run(name, allow):
    allowed = [t for t in times if allow(t)]
    worst = max(len([u for u in allowed if t <= u < t + 1000]) for t in allowed)
    print(f"{name}: allowed {len(allowed)} of {len(times)}, most in any 1 s: {worst}")


run("fixed window     ", FixedWindow(10, 1000).allow)
run("sliding log      ", SlidingWindowLog(10, 1000).allow)
run("token bucket     ", TokenBucket(10, 10).allow)

# Three gateways that each count on their own (the first attempt): requests rotate between them
gateways = [FixedWindow(10, 1000) for _ in range(3)]
turn = 0


def separate_gates(t):
    global turn
    allowed = gateways[turn % 3].allow(t)
    turn += 1
    return allowed


run("3 separate gates ", separate_gates)
