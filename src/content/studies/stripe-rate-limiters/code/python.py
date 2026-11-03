# A miniature of the limiters in Stripe's "Scaling your API with rate limiters" (2017), in Python (a teaching model, not Stripe's code):
# a token bucket per user (request rate), a cap on requests in progress, a fleet load shedder that reserves room for critical
# requests, a dark launch that only logs, and failing open when the limiter's own store breaks. Everything is deterministic.


class TokenBucket:
    def __init__(self, capacity, refill):
        self.capacity, self.refill, self.tokens = capacity, refill, capacity

    def tick(self):
        self.tokens = min(self.capacity, self.tokens + self.refill)

    def take(self):
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


print("--- request rate limiter: bucket of 5 tokens, refilled by 2 each second")
bucket = TokenBucket(5, 2)
for second, requests in [(1, 8), (2, 3)]:
    if second > 1:
        bucket.tick()
    allowed = sum(1 for _ in range(requests) if bucket.take())
    print(f"second {second}: {requests} requests -> {allowed} allowed, {requests - allowed} rejected with 429")

print("--- dark launch: same burst, but the limiter only logs")
dark = TokenBucket(5, 2)
would_reject = sum(1 for _ in range(8) if not dark.take())
print(f"second 1: 8 requests -> 8 allowed, {would_reject} would have been rejected (logged, not enforced)")

print("--- concurrent requests limiter: at most 2 in progress per user")
in_progress = 0


def start():
    global in_progress
    if in_progress >= 2:
        return False
    in_progress += 1
    return True


started = [start(), start(), start()]
print(f"3 slow requests at once -> {sum(started)} started, {started.count(False)} rejected with 429")
in_progress -= 1
print(f"one finishes, a new request -> {'started' if start() else 'rejected with 429'}")

print("--- fleet usage load shedder: 10 slots, 20% kept for critical requests")
SLOTS, RESERVED = 10, 2  # 20% of the slots
used = 0


def admit(critical):
    global used
    limit = SLOTS if critical else SLOTS - RESERVED  # non-critical traffic may use only 80%
    if used >= limit:
        return False
    used += 1
    return True


non_critical = [admit(False) for _ in range(9)]
print(f"9 non-critical requests (list charges) -> {sum(non_critical)} allowed, {non_critical.count(False)} rejected with 503")
critical = [admit(True) for _ in range(3)]
print(f"3 critical requests (create charge) -> {sum(critical)} allowed, {critical.count(False)} rejected with 503")

print("--- the limiter's own store fails")


def check_with_store(store_up):
    try:
        if not store_up:
            raise RuntimeError("store unreachable")
        return "checked normally"
    except RuntimeError as e:
        return f"limiter error ({e}), failing open: request allowed"


print(f"store up -> {check_with_store(True)}")
print(f"store down -> {check_with_store(False)}")
