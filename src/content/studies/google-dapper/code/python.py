# A miniature of Dapper, Google's tracing system (Google technical report, 2010), in Python (a teaching model, not Google's code):
# every traced request carries a trace id, span id and parent span id through its RPCs, the sampling decision is made once at the
# root and followed by every callee, each host writes spans to its own local log, a collector gathers the logs out of band, and
# the trace tree is rebuilt from the ids even when some hosts have not been collected yet. Everything is deterministic.
import re

RATE = 4  # trace 1 request in 4 (Dapper's real rates are as low as 1 in 1024)
REQUESTS = 20
logs = {"frontend": [], "auth": [], "search": [], "index": [], "ads": []}  # each host's local span log


def handle(trace_id):
    # One request: frontend calls auth and search; search calls index and ads. The times are made up and depend on the trace id.
    sampled = trace_id % RATE == 0  # decided once, at the root
    counter = [1]

    def span(host, name, parent, start, end):
        span_id = trace_id * 10 + counter[0]
        counter[0] += 1
        if sampled:  # untraced requests write nothing
            logs[host].append({"trace": trace_id, "id": span_id, "parent": parent, "name": name, "host": host, "start": start, "end": end})
        return span_id

    ads_time = 40 + (trace_id % 3) * 15
    root = span("frontend", "Frontend.Request", None, 0, 20 + 70 + ads_time)
    span("auth", "Auth.Check", root, 5, 15)
    search = span("search", "Search.Query", root, 20, 20 + 70 + ads_time)
    span("index", "Index.Lookup", search, 30, 60)
    span("ads", "Ads.Select", search, 30, 30 + ads_time)
    return sampled


sampled_ids = [i for i in range(1, REQUESTS + 1) if handle(i)]
written = sum(len(v) for v in logs.values())
print(f"{REQUESTS} requests, sampling 1 in {RATE}: traced " + ", ".join(map(str, sampled_ids)))
print(f"spans written: {written} instead of {REQUESTS * 5} if every request were traced")


def tree(spans, trace_id):  # rebuild the tree from ids alone
    mine = [s for s in spans if s["trace"] == trace_id]
    ids = {s["id"] for s in mine}
    lines = []

    def walk(parent, depth):
        for s in sorted((x for x in mine if x["parent"] == parent), key=lambda x: x["start"]):
            lines.append(f"{'  ' * depth}{s['name']} on {s['host']}: {s['start']}-{s['end']} ms ({s['end'] - s['start']} ms)")
            walk(s["id"], depth + 1)

    walk(None, 0)
    return lines, len(mine)


print("--- collection is out of band: the daemons have gathered every host except ads")
partial = [s for host, entries in logs.items() if host != "ads" for s in entries]
lines, count = tree(partial, 4)
print(f"trace 4 has {count} of 5 spans so far")
for line in lines:
    print(f"  {line}")
print("--- the ads host is collected")
everything = [s for entries in logs.values() for s in entries]
lines, count = tree(everything, 4)
print(f"trace 4 has {count} of 5 spans")
for line in lines:
    print(f"  {line}")
ranked = sorted(sampled_ids, key=lambda i: -int(re.search(r"\((\d+) ms\)", tree(everything, i)[0][0]).group(1)))
print(f"slowest traced request: trace {ranked[0]}, {tree(everything, ranked[0])[0][0]}")
