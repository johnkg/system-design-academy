# Ad click counting by event time, in Python:
# tumbling windows are closed by a watermark (the newest event time seen, minus the allowed lateness),
# events for a closed window are dropped as late, and a set of click ids removes duplicates.
import sys

SEED, CLICKS, SPAN_S = 7, 400, 300
ON_TIME_PCT, HELD_PCT = 85, 12  # the remaining 3% come from phones that were offline
ON_TIME_SPREAD, HELD_MIN, HELD_SPREAD, OFFLINE_MIN, OFFLINE_SPREAD = 3, 2, 9, 10, 36  # delays 0..2, 2..10, 10..45 s
RETRY_ONE_IN = 8
SOON_IN_5, SOON_MIN, SOON_SPREAD, LATE_COPY_MIN, LATE_COPY_SPREAD = 4, 1, 7, 15, 41  # copy delay: 4 in 5 after 1..7 s, else 15..55 s
WINDOW_S, EXACT_LATENESS = 30, 60  # EXACT_LATENESS exceeds every delay in the stream

seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# 400 true clicks over 300 seconds. Most arrive within 2 s, some are held up for up to 45 s (a phone that was offline).
# About 1 click in 8 is sent twice (a retry), and the copy arrives a few seconds, sometimes up to a minute, later.
def make_stream():
    events = []
    for id in range(CLICKS):
        t = random(SPAN_S)
        u = random(100)
        delay = random(ON_TIME_SPREAD) if u < ON_TIME_PCT else HELD_MIN + random(HELD_SPREAD) if u < ON_TIME_PCT + HELD_PCT else OFFLINE_MIN + random(OFFLINE_SPREAD)
        events.append({"id": id, "t": t, "arrival": t + delay, "copy": 0})
        if random(RETRY_ONE_IN) == 0:
            copy_delay = SOON_MIN + random(SOON_SPREAD) if random(5) < SOON_IN_5 else LATE_COPY_MIN + random(LATE_COPY_SPREAD)
            events.append({"id": id, "t": t, "arrival": t + delay + copy_delay, "copy": 1})
    return sorted(events, key=lambda e: (e["arrival"], e["id"], e["copy"]))


def aggregate(events, window_size, lateness, dedup):
    seen, counts, counted = set(), {}, set()
    max_time, closed_up_to, late, duplicates, delay_sum, closed_count = -1, -1, 0, 0, 0, 0
    for e in events:
        w = e["t"] // window_size
        if w <= closed_up_to:                                   # its window is already final
            late += 1
            continue
        if dedup and e["id"] in seen:                           # the same click again
            continue
        seen.add(e["id"])
        if e["id"] in counted:                                  # a click counted twice
            duplicates += 1
        counted.add(e["id"])
        counts[w] = counts.get(w, 0) + 1
        if e["t"] > max_time:                                   # the watermark can only move forward
            max_time = e["t"]
            while (closed_up_to + 2) * window_size <= max_time - lateness:  # the next window ends before the watermark
                closed_up_to += 1
                delay_sum += e["arrival"] - (closed_up_to + 1) * window_size
                closed_count += 1
    total = sum(counts.values())
    return {"total": total, "late": late, "duplicates": duplicates, "lost": CLICKS - len(counted), "avg_delay": delay_sum // closed_count}


events = make_stream()
copies = sum(1 for e in events if e["copy"] == 1)
print(f"stream: {len(events)} events = 400 clicks + {copies} retried copies")
rows = []
for window_size, lateness, dedup in [(30, 0, False), (30, 5, False), (30, 5, True), (30, 30, True), (30, 60, True), (10, 5, True), (60, 5, True)]:
    r = aggregate(events, window_size, lateness, dedup)
    rows.append({"dedup": dedup, **r})
    print(f"window {window_size}s lateness {lateness}s dedup {'on ' if dedup else 'off'}: counted {r['total']}, lost {r['lost']}, double counted {r['duplicates']}, late events dropped {r['late']}, window final after {r['avg_delay']}s")

ok = True
for r in rows:
    if r["dedup"] and r["duplicates"] != 0:
        ok = False                                              # dedup never counts a click twice
    if not r["dedup"] and r["total"] - CLICKS + r["lost"] != r["duplicates"]:
        ok = False                                              # counted = clicks seen + double counts
full = aggregate(events, WINDOW_S, EXACT_LATENESS, True)                          # more lateness than any delay, with dedup: exact
if full["total"] != CLICKS or full["lost"] != 0 or full["late"] != 0:
    ok = False
a, b, c = aggregate(events, WINDOW_S, 0, True), aggregate(events, WINDOW_S, 5, True), aggregate(events, WINDOW_S, 30, True)
if not (a["late"] >= b["late"] >= c["late"] >= full["late"]):
    ok = False                                                  # more lateness never drops more
print(f"invariants hold: {str(ok).lower()}")
if not ok:
    sys.exit(1)
