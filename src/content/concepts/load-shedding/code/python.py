# Load shedding: the same 3x overload against three queue policies. Deterministic discrete-time simulation, integers only.
# One step is 100 ms. The server completes 10 requests per step (100 per second). Clients give up after 20 steps (2 s).
STEPS, SPIKE_STEPS = 200, 100        # 20 s in total, the first 10 s overloaded
CAPACITY, TIMEOUT, LIMIT = 10, 20, 50
SPIKE_ARRIVALS, CALM_ARRIVALS = 30, 6  # 300 per second, then 60 per second
STEP_MS = 100


def run(policy):
    queue, head = [], 0              # each entry is the step the request arrived in
    good = wasted = rejected = dropped = lat_sum = 0
    for step in range(STEPS):
        for _ in range(SPIKE_ARRIVALS if step < SPIKE_STEPS else CALM_ARRIVALS):
            waiting = len(queue) - head
            if policy == "bounded" and waiting >= LIMIT:
                rejected += 1        # fail fast: an immediate 503, no queueing, no work
                continue
            if policy == "lifo" and waiting >= LIMIT:
                head += 1            # drop the oldest: its caller is the most likely to be gone
                dropped += 1
            queue.append(step)
        for _ in range(CAPACITY):
            if len(queue) - head == 0:
                break
            arrived = queue.pop() if policy == "lifo" else queue[head]
            if policy != "lifo":
                head += 1
            latency = step - arrived + 1
            if latency <= TIMEOUT:
                good += 1            # an answer the caller was still waiting for
                lat_sum += latency * STEP_MS
            else:
                wasted += 1          # the server was busy, but the caller had already left
    return {"good": good, "wasted": wasted, "rejected": rejected, "dropped": dropped,
            "left": len(queue) - head, "avg_ms": lat_sum // good if good else 0}


results = {p: run(p) for p in ("fifo", "bounded", "lifo")}
for name, r in results.items():
    print(f"{name:8} good={r['good']} wasted={r['wasted']} rejected={r['rejected']} dropped={r['dropped']} left={r['left']} avg_latency_ms={r['avg_ms']}")

fifo, bounded, lifo = results["fifo"], results["bounded"], results["lifo"]
assert bounded["good"] > fifo["good"], "fail-fast must beat an unbounded queue under 3x overload"
assert lifo["good"] > fifo["good"] and bounded["wasted"] == 0 and fifo["wasted"] > 0
assert lifo["avg_ms"] < bounded["avg_ms"], "newest-first answers faster than oldest-first"
assert fifo["left"] > 0 and bounded["left"] <= LIMIT
for r in results.values():
    assert r["good"] + r["wasted"] <= CAPACITY * STEPS
print("goodput ratio bounded/fifo:", bounded["good"] * 100 // fifo["good"], "percent")
