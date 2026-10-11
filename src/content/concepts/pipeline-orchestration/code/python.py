# A tiny orchestrator: a DAG of tasks per date, retries with backoff, upstream_failed, and clear-and-rerun.
# Each task writes 10 rows for its date. A failing attempt dies after writing 5 rows.
import sys

TASKS = [("extract", []), ("clean", [0]), ("aggregate", [1]), ("publish", [2])]
DATES = ["03-01", "03-02", "03-03"]
FULL, PARTIAL = 10, 5
# failing attempts per [date][task]: 03-02 clean fails once (transient), 03-03 aggregate fails every time (hard)
FAILS = [[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 99, 0]]


def run_pipeline(retries, idempotent, only, fails_left, state, rows, log):
    # only: set of "d:t" keys to run; None means everything. Tasks run in topological order (the list order).
    for d in range(len(DATES)):
        for t, (name, up) in enumerate(TASKS):
            key = f"{d}:{t}"
            if only is not None and key not in only:
                continue
            if any(state[d][u] != "success" for u in up):
                state[d][t] = "upstream_failed"
                log.append(f"{DATES[d]} {name} upstream_failed")
                continue
            attempt = 1
            while True:
                fail = fails_left[d][t] > 0
                if fail:
                    fails_left[d][t] -= 1
                n = PARTIAL if fail else FULL
                rows[key] = n if idempotent else rows.get(key, 0) + n  # overwrite the partition, or append
                if not fail:
                    state[d][t] = "success"
                    log.append(f"{DATES[d]} {name} success attempts={attempt}")
                    break
                if attempt > retries:
                    state[d][t] = "failed"
                    log.append(f"{DATES[d]} {name} failed attempts={attempt}")
                    break
                log.append(f"{DATES[d]} {name} retry in {2 ** attempt}m")
                attempt += 1


def scenario(label, retries, idempotent, clear_and_rerun):
    state = [["queued"] * len(TASKS) for _ in DATES]
    rows, log = {}, []
    fails_left = [r[:] for r in FAILS]
    run_pipeline(retries, idempotent, None, fails_left, state, rows, log)
    if clear_and_rerun:
        # the operator fixed the cause: clear every failed or upstream_failed instance and run them again
        only = set()
        for d, r in enumerate(state):
            for t, s in enumerate(r):
                if s != "success":
                    only.add(f"{d}:{t}")
        for k in only:
            d, t = map(int, k.split(":"))
            state[d][t] = "queued"
            fails_left[d][t] = 0
        run_pipeline(retries, idempotent, only, fails_left, state, rows, log)
    total = sum(rows.values())
    expected = len(DATES) * len(TASKS) * FULL
    print(f"== {label} ==")
    for l in log:
        print("  " + l)
    print(f"  rows={total} expected={expected} duplicates={max(0, total - expected)}")
    return total, expected, state


_, _, sa = scenario("no retries, overwrite, no operator", 0, True, False)
_, _, sb = scenario("2 retries, overwrite, no operator", 2, True, False)
tc, ec, _ = scenario("2 retries, overwrite, clear and rerun", 2, True, True)
td, ed, _ = scenario("2 retries, append, clear and rerun", 2, False, True)

if sa[1][1] != "failed" or sa[1][3] != "upstream_failed":
    sys.exit(1)
if sb[1][1] != "success" or sb[2][2] != "failed":
    sys.exit(1)
if tc != ec or td <= ed:
    sys.exit(1)
print("ok")
