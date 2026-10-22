# A request fans through A -> B -> C -> database on a virtual clock (milliseconds, no real waiting).
# The user waits 2000 ms. The database is sometimes slow. We compare three policies and count work
# that keeps running after its caller gave up ("orphans"). Cancellation is OFF: nothing tells a callee
# that its caller left, so only a hop that checks the deadline itself can stop.
import sys

USER, GAP, N, SLOW_PERMILLE, ATTEMPT, BACKOFF, RETRIES = 2000, 50, 200, 100, 400, 25, 2
PRE, POST, MIN_LEFT, RETRY_MIN = 10, 5, 50, 100
SEED = 12345
SLOW_MIN, SLOW_SPREAD, FAST_MIN, FAST_SPREAD = 2500, 6500, 20, 60  # database attempt latency (ms)
INF = float("inf")

seed = SEED  # Park-Miller generator, integers only so every language prints the same
def next_rand():
    global seed
    seed = (seed * 48271) % 2147483647
    return seed

# timeouts[0] = A waits on B, [1] = B waits on C, [2] = C waits on the database per attempt
POLICIES = {
    "fixed 5 s everywhere": ([5000, 5000, 5000], False),
    "fixed, tuned 1.8/1.2/0.4": ([1800, 1200, ATTEMPT], False),
    "propagated deadline": ([0, 0, ATTEMPT], True),
}

def simulate(timeouts, deadline, t0, attempts):
    D = t0 + USER
    spans = []  # each span: dict(hop, start, end, left, ok)

    def run(hop, start):
        span = {"hop": hop, "start": start, "end": start, "left": INF, "ok": False}
        spans.append(span)
        # Deadline mode: every hop enforces the absolute deadline itself and fails fast when little is left.
        cutoff = D if deadline else INF
        if deadline and D - start < MIN_LEFT:
            return span
        t, ok = start + PRE, False
        if t > cutoff:
            span["end"] = cutoff
            return span
        if hop < 2:
            give_up = min(D if deadline else t + timeouts[hop], cutoff)
            child = run(hop + 1, t)
            if child["ok"] and child["end"] <= give_up:
                ok, t = True, child["end"]
            else:
                if child["end"] > give_up:
                    child["left"] = give_up
                t = min(child["end"], give_up)
        else:
            for i in range(RETRIES + 1):
                give_up = min(t + timeouts[2], cutoff)
                natural = t + attempts[i]  # when the database would really finish
                db = {"hop": 3, "start": t, "end": min(natural, give_up if deadline else INF), "left": INF, "ok": False}
                spans.append(db)
                if natural <= give_up:
                    db["ok"] = ok = True
                    t = natural
                    break
                db["left"] = give_up
                t = give_up
                if i == RETRIES or t >= cutoff:
                    break
                if deadline and D - t - BACKOFF < RETRY_MIN:
                    break  # the retry would not fit in the budget
                t += BACKOFF
        if ok:
            if t + POST > cutoff:
                t, ok = cutoff, False
            else:
                t += POST
        span["end"], span["ok"] = t, ok
        return span

    top = run(0, t0)
    if top["end"] > D:
        top["left"] = D
    return spans, D, top["ok"] and top["end"] <= D

requests = []
for i in range(N):
    attempts = []
    for _ in range(RETRIES + 1):
        s, a = next_rand(), next_rand()
        attempts.append(SLOW_MIN + a % SLOW_SPREAD if s % 1000 < SLOW_PERMILLE else FAST_MIN + a % FAST_SPREAD)
    requests.append((i * GAP, attempts))

summary = {}
for name, (timeouts, deadline) in POLICIES.items():
    good = orphan_calls = orphan_ms = after_deadline = 0
    for t0, attempts in requests:
        spans, D, ok = simulate(timeouts, deadline, t0, attempts)
        good += ok
        for s in spans:
            o = max(0, s["end"] - s["left"])
            if o > 0:
                orphan_calls += 1
                orphan_ms += o
            if s["end"] > D:
                after_deadline += 1
    summary[name] = (good, orphan_calls, orphan_ms, after_deadline)
    print(f"{name:<26} within 2 s: {good}/{N}  orphan calls: {orphan_calls}  orphan time: {orphan_ms} ms  work after deadline: {after_deadline}")

dl, fixed = summary["propagated deadline"], summary["fixed 5 s everywhere"]
# Invariants: a hop that enforces the deadline never works past it and never leaves an orphan.
violations = [msg for bad, msg in [
    (dl[3] != 0 or dl[1] != 0, "deadline mode worked past the deadline"),
    (fixed[1] == 0, "fixed 5 s timeouts should leave orphans"),
    (dl[0] < fixed[0], "the deadline policy should never succeed less often"),
] if bad]
if violations:
    print("; ".join(violations))
    sys.exit(1)
print("deadline propagation did no work after the deadline")
