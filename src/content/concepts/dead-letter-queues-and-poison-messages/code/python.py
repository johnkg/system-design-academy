# Dead-letter queues: one ordered consumer over a seeded message list, four failure policies.
# Time is counted in ticks (one processing attempt per tick), so the output is deterministic.
SEED, TOTAL, LIMIT, HORIZON = 7, 40, 3, 400


def make_kinds():
    x, kinds = SEED, []
    for _ in range(TOTAL):
        x = (x * 48271) % 2147483647  # MINSTD, integer only
        r = x % 100
        kinds.append("poison" if r < 8 else "transient" if r < 25 else "ok")
    return kinds


def attempt_ok(kind, n):
    # poison always fails; transient fails on its first attempt only
    return kind == "ok" or (kind == "transient" and n > 1)


def run(policy, kinds):
    queue, delayed = list(range(TOTAL)), []  # delayed: [due_tick, id]
    tries = [0] * TOTAL
    delivered, dropped, parked, attempts = [], [], [], 0
    for tick in range(HORIZON):
        due = [d for d in delayed if d[0] <= tick]
        delayed = [d for d in delayed if d[0] > tick]
        queue += [d[1] for d in due]  # retry queue feeds the back of the main queue
        if not queue:
            continue
        mid = queue[0]
        tries[mid] += 1
        attempts += 1
        if attempt_ok(kinds[mid], tries[mid]):
            queue.pop(0)
            delivered.append(mid)
        elif policy == "forever":
            pass  # stays at the head: redelivered in place, blocking the queue
        elif policy == "backoff" and tries[mid] < LIMIT:
            queue.pop(0)
            delayed.append([tick + 2 ** tries[mid], mid])  # wait 2, 4, ... ticks
        elif policy != "backoff" and tries[mid] < LIMIT:
            pass  # immediate retry in place
        else:
            queue.pop(0)
            (dropped if policy == "drop" else parked).append(mid)
    stuck = len(queue) + len(delayed)
    pos = {m: i for i, m in enumerate(delivered)}
    inversions = sum(1 for a in delivered for b in delivered if a < b and pos[a] > pos[b])
    return dict(delivered=len(delivered), dropped=len(dropped), parked=len(parked),
                stuck=stuck, attempts=attempts, inversions=inversions)


kinds = make_kinds()
print(f"messages={TOTAL} poison={kinds.count('poison')} transient={kinds.count('transient')} limit={LIMIT}")
res = {}
for p in ["forever", "drop", "dlq", "backoff"]:
    r = res[p] = run(p, kinds)
    print(f"{p:<8} delivered={r['delivered']} dropped={r['dropped']} parked={r['parked']} "
          f"stuck={r['stuck']} attempts={r['attempts']} inversions={r['inversions']}")

poison = kinds.count("poison")
assert res["forever"]["stuck"] > 0 and res["forever"]["delivered"] < TOTAL - poison  # blocked behind a poison message
for p in ["dlq", "backoff"]:
    assert res[p]["stuck"] == 0 and res[p]["dropped"] == 0
    assert res[p]["delivered"] + res[p]["parked"] == TOTAL  # nothing lost
    assert res[p]["parked"] == poison  # only the real poison messages are parked
assert res["drop"]["dropped"] == poison  # lost for good
assert res["dlq"]["inversions"] == 0 and res["backoff"]["inversions"] > 0  # backoff trades order for progress
print("ok: forever blocks, drop loses, dlq and backoff lose nothing")
