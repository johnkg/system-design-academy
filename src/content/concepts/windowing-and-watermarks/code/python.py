# Tumbling event-time windows with a bounded-out-of-orderness watermark.
# Events arrive in processing order; each carries the event time (seconds) when the click happened.

WINDOW = 10
EVENTS = [1, 3, 12, 8, 5, 14, 22, 11, 25, 9, 31, 18, 35, 27, 41, 33]  # event times, in arrival order


def run(delay, verbose):
    """Return (fired, late). fired maps window start -> count emitted when the watermark passed its end."""
    open_windows = {}   # window start -> count, still waiting for the watermark
    fired = {}
    late = []
    max_time = None
    watermark = None    # None means "nothing seen yet"

    def fire_ready(label):
        for start in sorted(open_windows):
            if start + WINDOW <= watermark:
                fired[start] = open_windows.pop(start)
                if verbose:
                    print(f"  {label} wm={watermark} fire [{start},{start + WINDOW}) count={fired[start]}")

    for t in EVENTS:
        start = t // WINDOW * WINDOW
        if watermark is not None and start + WINDOW <= watermark:
            late.append(t)  # its window already fired: the result cannot be updated
            if verbose:
                print(f"  t={t} wm={watermark} LATE, dropped")
            continue
        open_windows[start] = open_windows.get(start, 0) + 1
        max_time = t if max_time is None else max(max_time, t)
        watermark = max_time - delay  # the watermark never moves backwards because max_time does not
        fire_ready(f"t={t}")
    # End of input: the watermark jumps to infinity and flushes everything left.
    watermark = 10**9
    fire_ready("end")
    return fired, late


truth = {}
for t in EVENTS:
    s = t // WINDOW * WINDOW
    truth[s] = truth.get(s, 0) + 1

for delay in (0, 5, 20):
    print(f"watermark delay {delay}s")
    fired, late = run(delay, verbose=(delay == 5))
    error = sum(abs(truth[s] - fired.get(s, 0)) for s in truth)
    counted = sum(fired.values())
    print(f"  windows={len(fired)} counted={counted} late={len(late)} error={error}")
    assert counted + len(late) == len(EVENTS), "every event is counted or late"
    assert error == len(late), "the only error is the dropped late events"
    if delay == 20:
        assert not late, "a delay above the worst disorder (16s) drops nothing"
