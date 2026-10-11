# A rolling-update planner. Given max surge and max unavailable, it produces the sequence of steps
# (start a v2 server, stop a v1 server) and checks that capacity never drops below the minimum.
# Integers only and no clock: one tick is one second, so the output is the same every run.

def plan(n, max_surge, max_unavailable, ready_after):
    if max_surge == 0 and max_unavailable == 0:
        raise ValueError("surge 0 and unavailable 0 can never make progress")
    old, new_ready, starting = n, 0, []  # v1 servers (all ready), ready v2 servers, countdowns for booting v2
    rows = []
    for tick in range(200):
        started = stopped = 0
        while True:
            new_count = new_ready + len(starting)
            total = old + new_count
            if new_count < n and total < n + max_surge:
                starting.append(ready_after)  # surge: bring up a v2 server first
                started += 1
            elif old > 0 and old + new_ready - 1 >= n - max_unavailable:
                old -= 1  # safe to remove: the ready count stays at or above n - max_unavailable
                stopped += 1
            else:
                break
        rows.append({"t": tick, "old": old, "new": new_ready, "starting": len(starting),
                     "ready": old + new_ready, "total": old + new_ready + len(starting),
                     "started": started, "stopped": stopped})
        if old == 0 and new_ready == n:
            return rows
        starting = [x - 1 for x in starting]  # time passes: boot and readiness checks progress
        new_ready += sum(1 for x in starting if x <= 0)
        starting = [x for x in starting if x > 0]
    raise RuntimeError("rollout did not finish")


def verify(rows, n, max_surge, max_unavailable):
    for r in rows:
        assert r["total"] <= n + max_surge, "too many servers at t=%d" % r["t"]
        assert r["ready"] >= n - max_unavailable, "capacity below the allowed minimum at t=%d" % r["t"]
    assert rows[-1]["new"] == n and rows[-1]["old"] == 0, "rollout incomplete"
    return min(r["ready"] for r in rows), max(r["total"] for r in rows)


N, DELAY, NEEDED = 6, 2, 5  # 6 servers, 2 s until ready, demand needs 5 ready servers
for surge, unavailable in [(1, 0), (0, 1), (2, 2), (0, 0)]:
    label = "surge=%d unavailable=%d" % (surge, unavailable)
    try:
        rows = plan(N, surge, unavailable, DELAY)
    except ValueError:
        print("%s: rejected (no progress possible)" % label)
        continue
    low, high = verify(rows, N, surge, unavailable)
    if (surge, unavailable) == (1, 0):
        for r in rows:
            print("t=%2d v1=%d v2=%d starting=%d ready=%d total=%d +%d -%d" % (
                r["t"], r["old"], r["new"], r["starting"], r["ready"], r["total"], r["started"], r["stopped"]))
    mixed = sum(1 for r in rows if r["old"] > 0 and r["new"] > 0)
    print("%s: %d ticks, min ready=%d, max servers=%d, mixed-version ticks=%d, keeps %d ready: %s" % (
        label, len(rows), low, high, mixed, NEEDED, str(low >= NEEDED).lower()))

# Blue-green needs no step plan: start N green servers, wait, flip the router once.
print("blue-green: peak servers=%d, ready after %d ticks, mixed-version ticks=0, rollback=1 router flip" % (2 * N, DELAY))
