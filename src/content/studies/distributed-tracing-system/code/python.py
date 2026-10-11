# Trace context and a tail sampler in Python:
# spans carry a W3C traceparent, arrive out of order, and a sampler buffers each trace for a wait before deciding to keep or drop it.
import math
import re
import sys


def format_traceparent(trace_id, span_id, sampled):
    return f"00-{trace_id}-{span_id}-{'01' if sampled else '00'}"


def parse_traceparent(header):
    m = re.fullmatch(r"00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})", header)
    if not m or set(m.group(1)) == {"0"} or set(m.group(2)) == {"0"}:  # all-zero ids are invalid
        return None
    return {"trace_id": m.group(1), "span_id": m.group(2), "sampled": (int(m.group(3), 16) & 1) == 1}


seed = 77


def next_u32():
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed


def nxt(n):
    return (next_u32() // 65536) % n


# 400 traces. About 4% fail and 6% are slow; 10% have an async span that ends long after the root span.
def make_traces():
    traces, events = [], []
    for i in range(400):
        start = i * 10 + nxt(10)
        trace_id = "".join(f"{next_u32():08x}" for _ in range(4))
        kind, n = nxt(100), 3 + nxt(5)
        root_dur = 30 + nxt(200) if kind < 4 else 800 + nxt(1200) if kind < 10 else 20 + nxt(80)
        err_at = 1 + nxt(n - 1) if kind < 4 else -1
        traces.append({"trace_id": trace_id, "n": n, "bad": kind < 10})
        for k in range(n):
            off, dur = 0, root_dur
            if k > 0:
                off = nxt(root_dur // 2 + 1)
                dur = 1 + nxt(max(1, root_dur - off))
            if k > 0 and nxt(100) < 10:
                off += 1000 + nxt(3000)  # async span, ends after the root
            arrival = start + off + dur + 5 + nxt(120)
            events.append({"arrival": arrival, "trace_id": trace_id, "root": k == 0, "dur": dur, "err": k == err_at})
    events.sort(key=lambda e: e["arrival"])  # stable, like the other versions
    return traces, events


class TailSampler:
    def __init__(self, wait):
        self.wait, self.open, self.decided, self.kept, self.late, self.peak = wait, {}, set(), {}, 0, 0

    def decide(self, t):
        del self.open[t["id"]]
        slow = any(s["root"] and s["dur"] >= 500 for s in t["spans"])
        error = any(s["err"] for s in t["spans"])
        baseline = int(t["id"][:8], 16) % 100 < 2  # keep 2% of ordinary traces
        self.decided.add(t["id"])
        if slow or error or baseline:
            self.kept[t["id"]] = len(t["spans"])

    def flush(self, now):
        for t in list(self.open.values()):  # oldest first
            if t["deadline"] <= now:
                self.decide(t)

    def add(self, e):
        self.flush(e["arrival"])
        if e["trace_id"] in self.decided:
            self.late += 1  # too late: this span is dropped
            return
        if e["trace_id"] not in self.open:
            self.open[e["trace_id"]] = {"id": e["trace_id"], "deadline": e["arrival"] + self.wait, "spans": []}
        self.open[e["trace_id"]]["spans"].append(e)
        self.peak = max(self.peak, len(self.open))

    def finish(self):
        self.flush(math.inf)


root = parse_traceparent(format_traceparent("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", True))
invalid = parse_traceparent("00-" + "0" * 32 + "-00f067aa0ba902b7-01") is None
print(f"traceparent round trip: trace {root['trace_id'][:8]}, sampled {str(root['sampled']).lower()}, invalid rejected {str(invalid).lower()}")

traces, events = make_traces()
bad = [t for t in traces if t["bad"]]
print(f"{len(traces)} traces, {len(events)} spans, {len(bad)} slow or failed")
results = {}
for wait in (100, 1000, 10000):
    s = TailSampler(wait)
    for e in events:
        s.add(e)
    s.finish()
    bad_kept = sum(1 for t in bad if t["trace_id"] in s.kept)
    incomplete = sum(1 for t in traces if t["trace_id"] in s.kept and s.kept[t["trace_id"]] < t["n"])
    results[wait] = {"bad_kept": bad_kept, "incomplete": incomplete, "peak": s.peak}
    print(f"wait {wait} ms: kept {len(s.kept)}, bad kept {bad_kept}/{len(bad)} ({(100 * bad_kept) // len(bad)}%), incomplete {incomplete}, late spans dropped {s.late}, peak buffered {s.peak}")
a, b, c = results[100], results[1000], results[10000]
ok = (c["bad_kept"] == len(bad) and c["incomplete"] == 0 and a["bad_kept"] < b["bad_kept"] <= c["bad_kept"]
      and a["peak"] < b["peak"] < c["peak"] and root["sampled"])
print(f"a longer wait keeps more bad traces and more of each trace, and buffers more: {str(ok).lower()}")
if not ok:
    sys.exit(1)
