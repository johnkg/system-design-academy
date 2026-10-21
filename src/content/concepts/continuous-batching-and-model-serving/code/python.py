# Static vs continuous batching over the same seeded request stream (one GPU replica, one decode step at a time).
# Step cost = 20 ms (weights read once) + 1 ms per sequence in the batch; prefill = 1 ms per 10 prompt tokens.
BASE, PER, MAX_BATCH = 20, 1, 8
TOKENS_PER_PREFILL_MS, MS_PER_SECOND = 10, 1000
GAP_STEPS = 1000  # resolution of the uniform arrival gap in [0, 2 * mean_gap)
# 80% short answers (16..63 tokens), the rest long (200..399); prompts are 64..963 tokens.
SHORT_PERCENT, SHORT_MIN, SHORT_SPREAD, LONG_MIN, LONG_SPREAD = 80, 16, 48, 200, 200
PROMPT_MIN, PROMPT_SPREAD = 64, 900
REQUESTS, SEED, MEAN_GAP_MS = 24, 7, 100


def make_requests(n, seed, mean_gap):
    s, t, reqs = seed, 0, []

    def nxt():
        """Linear congruential generator (Numerical Recipes constants), top 24 bits."""
        nonlocal s
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
        return s >> 8

    for _ in range(n):
        t += nxt() % GAP_STEPS * 2 * mean_gap // GAP_STEPS          # arrival time in ms
        out = SHORT_MIN + nxt() % SHORT_SPREAD if nxt() % 100 < SHORT_PERCENT else LONG_MIN + nxt() % LONG_SPREAD
        reqs.append({"at": t, "out": out, "prompt": PROMPT_MIN + nxt() % PROMPT_SPREAD})
    return reqs


def simulate(reqs, mode):
    t, nx, steps, tokens = 0, 0, 0, 0
    finish, queue, active = [-1] * len(reqs), [], []
    while True:
        while nx < len(reqs) and reqs[nx]["at"] <= t:
            queue.append(nx)
            nx += 1
        if not active and not queue:
            if nx >= len(reqs):
                break
            t = reqs[nx]["at"]                           # GPU idle until the next arrival
            continue
        prefill = 0
        # continuous: refill free slots every step; static: only when the whole batch is empty
        while (mode == "continuous" or not active) and len(active) < MAX_BATCH and queue:
            i = queue.pop(0)
            prefill += (reqs[i]["prompt"] + TOKENS_PER_PREFILL_MS - 1) // TOKENS_PER_PREFILL_MS
            active.append([i, reqs[i]["out"]])
        t += BASE + PER * len(active) + prefill          # finished static slots still cost compute (padding)
        steps += 1
        for a in active:
            if a[1] > 0:
                a[1] -= 1
                tokens += 1
        if mode == "continuous":
            for a in [a for a in active if a[1] == 0]:
                finish[a[0]] = t                         # leaves now, slot reused next step
            active = [a for a in active if a[1] > 0]
        elif all(a[1] == 0 for a in active):
            for a in active:
                finish[a[0]] = t                         # whole batch answers when the longest ends
            active = []
    lat = sorted(finish[i] - reqs[i]["at"] for i in range(len(reqs)))
    slots = steps * MAX_BATCH
    return {"tokens": tokens, "tps": tokens * MS_PER_SECOND // t, "p50": lat[(len(lat) - 1) * 50 // 100],
            "p95": lat[(len(lat) - 1) * 95 // 100], "idle": 100 * (slots - tokens) // slots, "steps": steps, "end": t}


reqs = make_requests(REQUESTS, SEED, MEAN_GAP_MS)
total = sum(r["out"] for r in reqs)
res = {}
for mode in ("static", "continuous"):
    r = res[mode] = simulate(reqs, mode)
    assert r["tokens"] == total, "every requested token must be generated exactly once"
    print(f"{mode:10} tokens/s={r['tps']} p50={r['p50']}ms p95={r['p95']}ms idle_slots={r['idle']}% steps={r['steps']} finished_at={r['end']}ms")
assert res["continuous"]["tps"] > res["static"]["tps"] and res["continuous"]["p95"] < res["static"]["p95"]
print(f"continuous batching: {res['continuous']['tps'] * 100 // res['static']['tps']}% of static throughput, "
      f"p95 {res['continuous']['p95'] * 100 // res['static']['p95']}% of static")
