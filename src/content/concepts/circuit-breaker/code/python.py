# A circuit breaker in Python with closed, open and half-open states. The clock is passed in so the demo is deterministic.
import time as _time


class CircuitBreaker:
    def __init__(self, call, failure_threshold=3, cooldown_ms=5000, now=lambda: int(_time.time() * 1000)):
        self.state = "closed"
        self._failures = 0
        self._opened_at = 0
        self.call = call
        self.failure_threshold = failure_threshold
        self.cooldown_ms = cooldown_ms
        self.now = now

    def run(self, *args):
        if self.state == "open":
            if self.now() - self._opened_at < self.cooldown_ms:
                raise RuntimeError("circuit open: failing fast")
            self.state = "half-open"  # cool-down over: allow a trial call
        try:
            result = self.call(*args)
            self.state = "closed"  # success (also closes from half-open)
            self._failures = 0
            return result
        except Exception:
            self._failures += 1
            if self.state == "half-open" or self._failures >= self.failure_threshold:
                self.state = "open"
                self._opened_at = self.now()
            raise


time = 0  # milliseconds, moved by hand
payment_api_is_up = False
real_calls = 0


def payment():
    global real_calls
    real_calls += 1
    if not payment_api_is_up:
        raise RuntimeError("payment API timed out")
    return "charged"


breaker = CircuitBreaker(payment, failure_threshold=3, cooldown_ms=5000, now=lambda: time)


def checkout(label):
    try:
        print(f"t={time}ms {label}: {breaker.run()} (breaker {breaker.state})")
    except RuntimeError as e:
        print(f"t={time}ms {label}: {e} (breaker {breaker.state})")


for label in ["c1", "c2", "c3", "c4", "c5"]:
    checkout(label)  # c4 and c5 never reach the API
time = 6000
payment_api_is_up = True  # the provider recovered
checkout("c6")  # half-open probe succeeds
checkout("c7")
print(f"real calls to the payment API: {real_calls}")
