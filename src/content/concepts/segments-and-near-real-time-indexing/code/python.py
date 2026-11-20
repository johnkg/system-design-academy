# Near-real-time indexing: documents wait in a memory buffer, a refresh turns the buffer into a new immutable segment
# that searches can see, and a merge policy combines similar-sized segments into bigger ones. Two minutes, in 100 ms ticks.
# Everything is integers and fixed events, so the output never changes.
TICK_MS = 100
END_MS = 120000      # 2 minutes simulated
UPDATE_EVERY = 10    # every 10th new document replaces an older one: the old copy is only marked deleted


# docs_per_sec: arrivals (a multiple of 10); refresh_ms: a multiple of 100; merge_at: segments of one level that trigger a merge (0 = never merge)
def run(docs_per_sec, refresh_ms, merge_at):
    per_tick = docs_per_sec * TICK_MS // 1000
    segments = []  # dicts: docs counts every document stored, dead those marked deleted
    buffer = arrived = flushed = merge_written = merges = created = 0
    delay_sum = delay_max = peak = seg_ticks = ticks = 0
    pending = []   # arrival time (middle of the tick) of each tick's batch that is not yet searchable

    for t in range(TICK_MS, END_MS + 1, TICK_MS):
        buffer += per_tick
        pending.append(t - TICK_MS // 2)
        for _ in range(per_tick):
            arrived += 1
            if arrived % UPDATE_EVERY == 0:
                old = next((s for s in segments if s["docs"] - s["dead"] > 0), None)
                if old:
                    old["dead"] += 1  # a delete is a mark, the document stays on disk until a merge rewrites the segment
        if t % refresh_ms == 0 and buffer > 0:
            segments.append({"level": 0, "docs": buffer, "dead": 0})
            created += 1
            flushed += buffer
            buffer = 0
            for at in pending:
                d = t - at
                delay_sum += d * per_tick
                delay_max = max(delay_max, d)
            pending.clear()
            while merge_at > 0:
                level = -1
                for l in range(20):
                    if level < 0 and sum(1 for s in segments if s["level"] == l) >= merge_at:
                        level = l
                if level < 0:
                    break
                group = [s for s in segments if s["level"] == level][:merge_at]
                live = sum(s["docs"] - s["dead"] for s in group)
                for s in group:
                    segments.remove(s)
                segments.append({"level": level + 1, "docs": live, "dead": 0})
                merge_written += live
                merges += 1
        peak = max(peak, len(segments))
        seg_ticks += len(segments)
        ticks += 1
    dead = sum(s["dead"] for s in segments)
    return {
        "arrived": arrived, "created": created, "merges": merges, "peak": peak, "final": len(segments),
        "delay_avg": delay_sum // flushed, "delay_max": delay_max,
        "amp_x100": (flushed + merge_written) * 100 // flushed, "written": flushed + merge_written, "dead": dead,
    }


def show(name, r):
    print(f"-- {name}")
    print(f"  searchable after {r['delay_avg']} ms on average, {r['delay_max']} ms at worst")
    print(f"  segments: {r['created']} created, {r['merges']} merges, peak {r['peak']}, {r['final']} at the end (a query visits every one)")
    print(f"  disk writes: {r['written']} documents for {r['arrived']} arrived (write amplification x100 = {r['amp_x100']}); {r['dead']} deleted copies still on disk")


cases = [
    ("500 docs/s, refresh 1 s, merge at 10 similar segments", run(500, 1000, 10)),
    ("500 docs/s, refresh 100 ms, never merge", run(500, 100, 0)),
    ("500 docs/s, refresh 100 ms, merge at 10 similar segments", run(500, 100, 10)),
    ("500 docs/s, refresh 30 s, merge at 10 similar segments", run(500, 30000, 10)),
    ("500 docs/s, refresh 1 s, merge at 4 similar segments", run(500, 1000, 4)),
]
for name, r in cases:
    show(name, r)
if cases[1][1]["peak"] <= cases[2][1]["peak"] * 10 or cases[3][1]["delay_avg"] <= cases[0][1]["delay_avg"]:
    raise SystemExit("impossible result")
