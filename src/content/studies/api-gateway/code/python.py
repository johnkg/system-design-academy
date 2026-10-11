# A gateway fleet's two safety valves, in Python:
# 1) a per-consumer rate limit counted by several instances, exact or approximate, and 2) a retry budget.

LIMIT = 1000  # requests per second allowed for each consumer
seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# One second in 100 ticks of 10 ms. The abuser sends 30 requests a tick (3,000 a second), a well-behaved consumer 9 (900 a second).
# The load balancer sends every request to a random instance. Returns how many requests were admitted.
def simulate(mode, instances):
    global seed
    seed = 7
    consumers = [
        {"rate": 30, "local": [0] * instances, "seen": [0] * instances, "shared": 0, "admitted": 0},
        {"rate": 9, "local": [0] * instances, "seen": [0] * instances, "shared": 0, "admitted": 0},
    ]
    share = LIMIT // instances
    for tick in range(100):
        for c in consumers:
            if mode == "sync" and tick % 10 == 0:  # every 100 ms each instance reports its count and reads the total
                for i in range(instances):
                    c["shared"] += c["local"][i]
                    c["local"][i] = 0
                c["seen"] = [c["shared"]] * instances
            for _ in range(c["rate"]):
                i = random(instances)
                if mode == "central":
                    ok = c["shared"] < LIMIT                    # one atomic counter in the shared store
                elif mode == "local":
                    ok = c["local"][i] < LIMIT                  # every instance enforces the whole limit alone
                elif mode == "split":
                    ok = c["local"][i] < share                  # every instance gets an equal share
                else:
                    ok = c["seen"][i] + c["local"][i] < LIMIT   # sync: the last known total plus what I added since
                if not ok:
                    continue
                if mode == "central":
                    c["shared"] += 1
                else:
                    c["local"][i] += 1
                c["admitted"] += 1
    return {"abuser": consumers[0]["admitted"], "wrongly_rejected": 900 - consumers[1]["admitted"]}


# Retries: a failed attempt is retried up to 3 times. With a budget, a retry costs 10 tokens and every request earns 1 token, so retries stay under 10% of requests.
def retries(fail_percent, budget):
    global seed
    seed = 99
    attempts = succeeded = tokens = 0
    for _ in range(1000):
        tokens = min(tokens + 1, 200)
        for tries in range(4):
            if tries > 0 and budget:
                if tokens < 10:
                    break
                tokens -= 10
            attempts += 1
            if random(100) >= fail_percent:
                succeeded += 1
                break
    return {"attempts": attempts, "succeeded": succeeded}


results = {}
for mode in ["central", "local", "split", "sync"]:
    results[mode] = simulate(mode, 8)
    print(f"{mode.ljust(7)} 8 instances: abuser admitted {results[mode]['abuser']} of 3000 (limit {LIMIT}), well-behaved consumer wrongly rejected {results[mode]['wrongly_rejected']}")
wide = simulate("split", 32)
print(f"split   32 instances: abuser admitted {wide['abuser']}, well-behaved consumer wrongly rejected {wide['wrongly_rejected']}")

unlimited, budgeted = retries(60, False), retries(60, True)
print(f"upstream failing 60%: unlimited retries send {unlimited['attempts']} attempts ({unlimited['succeeded']} ok), budget sends {budgeted['attempts']} attempts ({budgeted['succeeded']} ok)")

ok = (results["central"]["abuser"] == LIMIT and results["central"]["wrongly_rejected"] == 0
      and results["local"]["abuser"] == 3000                                          # a limit enforced per instance is no limit
      and results["split"]["abuser"] <= LIMIT and wide["wrongly_rejected"] > 0       # an even split is safe, but rejects good traffic when counts are uneven
      and LIMIT < results["sync"]["abuser"] <= LIMIT + 300                           # sync overshoots by about one interval of traffic
      and results["sync"]["wrongly_rejected"] == 0
      and budgeted["attempts"] <= 1100 and unlimited["attempts"] > 2000)
if not ok:
    raise SystemExit(1)
