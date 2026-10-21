# Batch vs stream on the same late-arriving events: count orders per 10-minute window of EVENT time.
# The stream answers fast from a watermark and drops what comes too late; the batch recomputes the log on a schedule.

WIN, NWIN, REPORT, SPAN = 600, 8, 6, 4800  # window (s), windows, windows reported, event-time span (s)
LATE_MIN = 20  # a late event arrives at least this many seconds after it happened
ON_TIME_JITTER = 4  # an on-time event arrives 0..3 s after it happened
SECONDS_PER_MINUTE = 60
EVENT_COUNT, LATE_PCT, LATE_MAX, SEED = 800, 10, 300, 7
SHORT_WAIT = 30  # seconds the first stream waits past a window's end


def generate(n, late_pct, late_max, seed):
    s = seed & 0xFFFFFFFF

    def nxt():  # 32-bit LCG (Numerical Recipes constants)
        nonlocal s
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
        return s >> 8

    events = []
    for i in range(n):
        t = nxt() % SPAN  # when it happened (event time, seconds)
        r = nxt() % 100
        delay = LATE_MIN + nxt() % (late_max - LATE_MIN + 1) if r < late_pct else nxt() % ON_TIME_JITTER
        events.append((i, t, t + delay))  # a = when it reaches us (processing time)
    return events


def true_counts(events):
    c = [0] * REPORT
    for _, t, _ in events:
        w = t // WIN
        if w < REPORT:
            c[w] += 1
    return c


def run_stream(events, wait):
    """One pass in arrival order. A window is emitted once watermark = newest event time - wait passes its end."""
    order = sorted(events, key=lambda e: (e[2], e[1], e[0]))
    count, emitted = [0] * NWIN, [False] * NWIN
    at, seen = [0] * NWIN, [0] * NWIN
    dropped, max_t, last = 0, -1, 0
    for _, t, a in order:
        w = t // WIN
        last = a
        if emitted[w]:
            if w < REPORT:
                dropped += 1  # too late: the window is already out
        else:
            count[w] += 1
        max_t = max(max_t, t)
        for x in range(NWIN):
            if not emitted[x] and (x + 1) * WIN <= max_t - wait:
                emitted[x], at[x], seen[x] = True, a, count[x]
    for x in range(NWIN):
        if not emitted[x]:
            emitted[x], at[x], seen[x] = True, last, count[x]
    truth = true_counts(events)
    rows = [(w, truth[w], seen[w], at[w], at[w] if seen[w] == truth[w] else -1) for w in range(REPORT)]
    return rows, len(events), dropped


def run_batch(events, minutes):
    """Every `minutes` re-read the whole log. A window is exact at the first run that has seen all of its events."""
    step, truth = minutes * SECONDS_PER_MINUTE, true_counts(events)

    def count_at(w, run):
        return sum(1 for _, t, a in events if a <= run and t // WIN == w)

    rows, last_run = [], 0
    for w in range(REPORT):
        run = -(-((w + 1) * WIN) // step) * step
        first_at, first = run, count_at(w, run)
        while count_at(w, run) != truth[w]:
            run += step
        rows.append((w, truth[w], first, first_at, run))
        last_run = max(last_run, run)
    read = 0
    for run in range(step, last_run + 1, step):
        read += sum(1 for _, _, a in events if a <= run)
    return rows, read, 0


def mean(xs):
    return (2 * sum(xs) + len(xs)) // (2 * len(xs))  # floor(x + 0.5) without float rounding


def report(label, res):
    rows, read, _ = res
    missing = sum(r[1] - r[2] for r in rows)
    total = sum(r[1] for r in rows)
    delay = mean([r[3] - (r[0] + 1) * WIN for r in rows])
    print(f"{label}: first answer +{delay}s, missing {missing}/{total}, events read {read}")
    return missing


events = generate(EVENT_COUNT, LATE_PCT, LATE_MAX, SEED)
stream30 = run_stream(events, SHORT_WAIT)
print("window  true  first  answered_at")
for w, truth, first, first_at, _ in stream30[0]:
    print(f"{w}       {truth}   {first}    +{first_at - (w + 1) * WIN}s")

miss_stream30 = report("stream wait 30s ", stream30)
miss_stream300 = report("stream wait 300s", run_stream(events, LATE_MAX))
batch15 = run_batch(events, 15)
batch60 = run_batch(events, 60)
report("batch every 15m", batch15)
report("batch every 60m", batch60)

# Invariants: dropped events are exactly the missing ones, a long wait loses nothing, and every batch ends exact.
assert miss_stream30 == stream30[2], "dropped count mismatch"
assert miss_stream300 == 0, "a wait as long as the lateness must lose nothing"
for b in (batch15, batch60):
    assert all(r[4] >= 0 for r in b[0]), "batch must end exact"
print("invariants ok")
