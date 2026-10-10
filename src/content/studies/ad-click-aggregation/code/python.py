# Ad click counting by event time, in Python:
# tumbling windows are closed by a watermark (the newest event time seen, minus the allowed lateness),
# events for a closed window are dropped as late, and a set of click ids removes duplicates.
import sys

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# 400 true clicks over 300 seconds. Most arrive within 2 s, some are held up for up to 45 s (a phone that was offline).
# About 1 click in 8 is sent twice (a retry), and the copy arrives a few seconds, sometimes up to a minute, later.
def make_stream():
    events = []
    for id in range(400):
        t = random(300)
        u = random(100)
        delay = random(3) if u < 85 else 2 + random(9) if u < 97 else 10 + random(36)
        events.append({"id": id, "t": t, "arrival": t + delay, "copy": 0})
        if random(8) == 0:
            events.append({"id": id, "t": t, "arrival": t + delay + (1 + random(7) if random(5) < 4 else 15 + random(41)), "copy": 1})
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
    return {"total": total, "late": late, "duplicates": duplicates, "lost": 400 - len(counted), "avg_delay": delay_sum // closed_count}


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
    if not r["dedup"] and r["total"] - 400 + r["lost"] != r["duplicates"]:
        ok = False                                              # counted = clicks seen + double counts
full = aggregate(events, 30, 60, True)                          # more lateness than any delay, with dedup: exact
if full["total"] != 400 or full["lost"] != 0 or full["late"] != 0:
    ok = False
a, b, c = aggregate(events, 30, 0, True), aggregate(events, 30, 5, True), aggregate(events, 30, 30, True)
if not (a["late"] >= b["late"] >= c["late"] >= full["late"]):
    ok = False                                                  # more lateness never drops more
print(f"invariants hold: {str(ok).lower()}")
if not ok:
    sys.exit(1)
