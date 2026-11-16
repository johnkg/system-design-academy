# An image pipeline under a bulk import, second by second for 20 minutes. Sellers upload 10 photos a second; each
# photo takes a worker 2 seconds (6 variants). At 60 s a big seller imports 100,000 photos at once. Some images are
# broken and make a worker spend 30 seconds before it gives up. Everything is integers, so the output never changes.
END = 1200          # seconds simulated
LIVE_PER_S = 10     # photos a second from sellers editing their listings
COST = 2            # worker-seconds per photo
POISON_COST = 30    # worker-seconds a broken image burns before the job times out
BULK_AT = 60        # the bulk import arrives at this second
POISON_AT = 120     # broken images arrive at this second, among the live uploads
MAX_TRIES = 3       # with backoff, a job that failed this often goes to the dead-letter queue
BACKOFF = 10        # first retry waits this long, then doubles
MIN_W, MAX_W, BOOT, SCALE_EVERY, DRAIN = 30, 400, 60, 30, 120  # autoscaler


def cost(b):
    return POISON_COST if b["kind"] == "poison" else COST


def run(name, lanes, workers, bulk, poison, backoff, autoscale):
    live, batch, waiting, pending = [], [], [], []
    lat = {}  # seconds from upload to done -> photos
    w, budget, bulk_done, bulk_end, burned, dlq, worker_seconds = workers, 0, 0, -1, 0, 0, 0

    def lane_of(kind):
        return batch if lanes and kind == "bulk" else live

    for t in range(END):
        live.append({"t": t, "kind": "live", "n": LIVE_PER_S, "tries": 0})
        if t == BULK_AT and bulk:
            lane_of("bulk").append({"t": t, "kind": "bulk", "n": bulk, "tries": 0})
        if t == POISON_AT:
            for _ in range(poison):
                live.append({"t": t, "kind": "poison", "n": 1, "tries": 0})
        for i in range(len(waiting) - 1, -1, -1):
            if waiting[i]["ready"] <= t:
                live.append(waiting[i]["b"])
                del waiting[i]
        for i in range(len(pending) - 1, -1, -1):
            if pending[i][0] <= t:
                w += pending[i][1]
                del pending[i]
        if autoscale and t % SCALE_EVERY == 0:
            backlog = sum(b["n"] * cost(b) for b in live + batch)
            target = min(MAX_W, MIN_W + (backlog + DRAIN - 1) // DRAIN)
            planned = w + sum(p[1] for p in pending)
            if target > planned:
                pending.append([t + BOOT, target - planned])
            elif target < w and not pending:
                w = target
        worker_seconds += w
        budget += w
        for q in (live, batch):
            while q and budget >= cost(q[0]):
                b = q[0]
                c = cost(b)
                k = min(b["n"], budget // c)
                budget -= k * c
                b["n"] -= k
                if b["kind"] == "live":
                    d = t - b["t"] + COST  # waited, then 2 s of work
                    lat[d] = lat.get(d, 0) + k
                if b["kind"] == "bulk":
                    bulk_done += k
                    if bulk_done == bulk:
                        bulk_end = t
                if b["kind"] == "poison":
                    burned += c
                    b["tries"] += 1
                    if not backoff:
                        q.append({**b, "n": 1})  # retry at once, for ever
                    elif b["tries"] >= MAX_TRIES:
                        dlq += 1  # give up: a person looks at it
                    else:
                        waiting.append({"ready": t + BACKOFF * 2 ** (b["tries"] - 1), "b": {**b, "n": 1}})
                if b["n"] == 0:
                    q.pop(0)
        if not live and not batch:
            budget = 0  # idle time cannot be saved up

    total = LIVE_PER_S * END
    seen, p95, fast = 0, -1, 0
    for s in sorted(lat):
        seen += lat[s]
        if s <= 10:
            fast = seen
        if p95 < 0 and seen * 100 >= total * 95:
            p95 = s
    print(f"-- {name}")
    print(f"  live photos: p95 {'over 20 min' if p95 < 0 else f'{p95}s'}, {fast * 100 // total}% within 10s")
    if not bulk:
        bulk_text = "none"
    elif bulk_end < 0:
        bulk_text = f"{bulk_done} of {bulk} done"
    else:
        bulk_text = f"done at {bulk_end}s"
    print(f"  bulk import: {bulk_text}; broken images burned {burned} worker-seconds, {dlq} in the dead-letter queue")
    print(f"  {w} workers at the end, {worker_seconds // 3600} worker-hours used")
    if bulk_done > bulk or fast > total:
        raise RuntimeError("impossible count")


base = {"lanes": False, "workers": 30, "bulk": 100000, "poison": 0, "backoff": False, "autoscale": False}
run("one queue, 30 workers", **base)
run("separate lanes", **{**base, "lanes": True})
run("separate lanes, autoscaled", **{**base, "lanes": True, "autoscale": True})
run("separate lanes, 5 broken images retried at once", **{**base, "lanes": True, "poison": 5})
run("separate lanes, 5 broken images, backoff and a dead-letter queue", **{**base, "lanes": True, "poison": 5, "backoff": True})
run("separate lanes, autoscaled, 5 broken images retried at once", **{**base, "lanes": True, "autoscale": True, "poison": 5})
