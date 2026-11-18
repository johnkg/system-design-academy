# Loading one screen that needs 12 small requests over a flaky mobile link, with three client strategies, and then a fleet
# of phones reconnecting at once after an outage. Milliseconds and integers only; the seeds are fixed.
REQS = 12             # requests the screen needs
ESSENTIAL = 4         # the first 4 make the screen usable; the other 8 only fill it in
MAX_ATTEMPTS = 4      # attempts per request (or per batch) before giving up
TRANSFER_MS = 20      # time to move one request's data once the round trip is done
RENDER_GAP_MS = 1500  # the sequential client renders each part before it asks for the next
TAIL_MS = 1000        # the radio stays awake this long after a transfer; a request after that wakes it again
FIXED_TIMEOUT_MS = 1000
BASE_BACKOFF_MS = 500
MAX_BACKOFF_MS = 8000
RETRY_BUDGET = 12     # retries the parallel client may spend in total across all its requests


def make_rng(seed):
    state = [seed]

    def nxt():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]

    return nxt


# The link: for every request and attempt, a loss roll (0 to 99) and a jitter roll (0 to 99). Same for every strategy.
def link_rolls():
    nxt = make_rng(150)
    rows = []
    for _ in range(REQS):
        row = []
        for _ in range(MAX_ATTEMPTS):
            roll = nxt() % 100
            jit = nxt() % 100
            row.append((roll, jit))
        rows.append(row)
    return rows


# Exponential backoff with "equal jitter": half the delay is fixed, the other half is random.
def backoff(attempt, jit):
    cap = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
    return cap // 2 + (cap // 2) * jit // 100


# Radio wake-ups: a transfer that starts more than TAIL_MS after the radio last went quiet wakes it again.
def wake_ups(intervals):
    last = None
    wakes = 0
    for start, end in sorted(intervals, key=lambda iv: iv[0]):
        if last is None or start - last > TAIL_MS:
            wakes += 1
        last = end if last is None else max(last, end)
    return wakes


def load_screen(strategy, loss_pct, rtt):
    rolls = link_rolls()
    intervals = []
    attempts = failed = usable = 0
    essential_failed = False
    if strategy == "sequential":
        t = 0
        for i in range(REQS):
            ok = False
            j = 0
            while j < MAX_ATTEMPTS and not ok:
                attempts += 1
                dur = rtt + TRANSFER_MS
                if rolls[i][j][0] >= loss_pct and dur <= FIXED_TIMEOUT_MS:
                    intervals.append((t, t + dur))
                    t += dur
                    ok = True
                else:
                    intervals.append((t, t + FIXED_TIMEOUT_MS))
                    t += FIXED_TIMEOUT_MS  # wait out the fixed timeout, retry at once
                j += 1
            if not ok:
                failed += 1
                if i < ESSENTIAL:
                    essential_failed = True
            if i == ESSENTIAL - 1:
                usable = t
            t += RENDER_GAP_MS
    elif strategy == "parallel":
        budget = RETRY_BUDGET
        for i in range(REQS):
            t = 0
            ok = False
            timeout = 4 * rtt  # follows the network instead of a fixed number
            for j in range(MAX_ATTEMPTS):
                attempts += 1
                dur = rtt + TRANSFER_MS
                if rolls[i][j][0] >= loss_pct and dur <= timeout:
                    intervals.append((t, t + dur))
                    t += dur
                    ok = True
                    break
                intervals.append((t, t + timeout))
                t += timeout
                if j == MAX_ATTEMPTS - 1 or budget == 0:
                    break  # out of attempts, or the shared retry budget is spent
                budget -= 1
                t += backoff(j, rolls[i][j][1])
            if not ok:
                failed += 1
                if i < ESSENTIAL:
                    essential_failed = True
            elif i < ESSENTIAL:
                usable = max(usable, t)
    else:
        t = 0
        ok = False
        timeout = 4 * rtt + 300
        for j in range(MAX_ATTEMPTS):
            attempts += 1
            dur = rtt + TRANSFER_MS * REQS
            # The reply is 12 times bigger, so it is twice as likely to be hit by the loss.
            if rolls[0][j][0] >= min(100, 2 * loss_pct) and dur <= timeout:
                intervals.append((t, t + dur))
                t += dur
                ok = True
                break
            intervals.append((t, t + timeout))
            t += timeout
            if j == MAX_ATTEMPTS - 1:
                break
            t += backoff(j, rolls[0][j][1])
        if ok:
            usable = t
        else:
            failed = REQS
            essential_failed = True
    return -1 if essential_failed else usable, attempts, failed, wake_ups(intervals)


# A fleet reconnects at the same moment. The server can serve 2,000 requests a second; the rest get an error and retry.
SERVER_CAPACITY = 2000
FLEET_MAX_ATTEMPTS = 8


def fleet(phones, jitter):
    nxt = make_rng(11)
    next_at = [0] * phones
    attempt = [0] * phones
    pending = set()
    for p in range(phones):
        if jitter:
            next_at[p] = nxt() % 10000  # jitter: each phone waits 0 to 10 s first
        pending.add(p)
    peak = rejected = gave_up = finished = 0
    sec = 0
    while sec < 300 and pending:
        arrivals = sorted((p for p in pending if next_at[p] // 1000 == sec), key=lambda p: (next_at[p], p))
        if arrivals:
            peak = max(peak, len(arrivals))
            for k, p in enumerate(arrivals):
                if k < SERVER_CAPACITY:
                    pending.discard(p)
                    finished = sec
                    continue
                rejected += 1
                attempt[p] += 1
                if attempt[p] >= FLEET_MAX_ATTEMPTS:
                    gave_up += 1
                    pending.discard(p)
                    continue
                delay = min(60000, 1000 * 2 ** (attempt[p] - 1))
                next_at[p] += nxt() % delay if jitter else delay  # full jitter spreads the retries; without it they come back in step
        sec += 1
    return peak, rejected, gave_up, finished


NAMES = {"sequential": "sequential, fixed 1,000 ms timeout, immediate retry", "parallel": "parallel, backoff with jitter, retry budget", "batch": "one batched request"}
for loss, rtt in [(10, 300), (30, 300), (10, 1200)]:
    print(f"-- packet loss {loss}%, round trip {rtt} ms")
    for s in ["sequential", "parallel", "batch"]:
        usable, attempts, failed, wakes = load_screen(s, loss, rtt)
        shown = "never" if usable < 0 else f"{usable} ms"
        print(f"  {NAMES[s]}: usable after {shown}; {attempts} requests sent; {failed} failed; {wakes} radio wake-ups")
print("-- 10000 phones reconnect at once, server serves 2000 requests a second")
for jitter in [False, True]:
    peak, rejected, gave_up, finished = fleet(10000, jitter)
    print(f"  {'with' if jitter else 'without'} jitter: peak {peak} requests/s, {rejected} rejected, all served by second {finished}, {gave_up} gave up")
