# A gateway fleet's two safety valves, in Python:
# 1) a per-consumer rate limit counted by several instances, exact or approximate, and 2) a retry budget.

LIMIT = 1000  # requests per second allowed for each consumer
SEED, RETRY_SEED = 7, 99
TICKS, SYNC_EVERY = 100, 10  # one second of 10 ms ticks; sync every 100 ms
ABUSER_RATE, GOOD_RATE = 30, 9  # requests per tick
INSTANCES, WIDE_INSTANCES = 8, 32
REQUESTS, MAX_TRIES, RETRY_COST, TOKEN_CAP = 1000, 4, 10, 200  # 1 try + 3 retries; a retry costs 10 tokens
FAIL_PERCENT = 60
seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# One second in 100 ticks of 10 ms. The abuser sends 30 requests a tick (3,000 a second), a well-behaved consumer 9 (900 a second).
# The load balancer sends every request to a random instance. Returns how many requests were admitted.
def simulate(mode, instances):
    global seed
    seed = SEED
    consumers = [
        {"rate": ABUSER_RATE, "local": [0] * instances, "seen": [0] * instances, "shared": 0, "admitted": 0},
        {"rate": GOOD_RATE, "local": [0] * instances, "seen": [0] * instances, "shared": 0, "admitted": 0},
    ]
    share = LIMIT // instances
    for tick in range(TICKS):
        for c in consumers:
            if mode == "sync" and tick % SYNC_EVERY == 0:  # every 100 ms each instance reports its count and reads the total
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
    return {"abuser": consumers[0]["admitted"], "wrongly_rejected": GOOD_RATE * TICKS - consumers[1]["admitted"]}


# Retries: a failed attempt is retried up to 3 times. With a budget, a retry costs 10 tokens and every request earns 1 token, so retries stay under 10% of requests.
def retries(fail_percent, budget):
    global seed
    seed = RETRY_SEED
    attempts = succeeded = tokens = 0
    for _ in range(REQUESTS):
        tokens = min(tokens + 1, TOKEN_CAP)
        for tries in range(MAX_TRIES):
            if tries > 0 and budget:
                if tokens < RETRY_COST:
                    break
                tokens -= RETRY_COST
            attempts += 1
            if random(100) >= fail_percent:
                succeeded += 1
                break
    return {"attempts": attempts, "succeeded": succeeded}


results = {}
for mode in ["central", "local", "split", "sync"]:
    results[mode] = simulate(mode, INSTANCES)
    print(f"{mode.ljust(7)} 8 instances: abuser admitted {results[mode]['abuser']} of 3000 (limit {LIMIT}), well-behaved consumer wrongly rejected {results[mode]['wrongly_rejected']}")
wide = simulate("split", WIDE_INSTANCES)
print(f"split   32 instances: abuser admitted {wide['abuser']}, well-behaved consumer wrongly rejected {wide['wrongly_rejected']}")

unlimited, budgeted = retries(FAIL_PERCENT, False), retries(FAIL_PERCENT, True)
print(f"upstream failing 60%: unlimited retries send {unlimited['attempts']} attempts ({unlimited['succeeded']} ok), budget sends {budgeted['attempts']} attempts ({budgeted['succeeded']} ok)")

ok = (results["central"]["abuser"] == LIMIT and results["central"]["wrongly_rejected"] == 0
      and results["local"]["abuser"] == ABUSER_RATE * TICKS                                        # a limit enforced per instance is no limit
      and results["split"]["abuser"] <= LIMIT and wide["wrongly_rejected"] > 0       # an even split is safe, but rejects good traffic when counts are uneven
      and LIMIT < results["sync"]["abuser"] <= LIMIT + ABUSER_RATE * SYNC_EVERY                           # sync overshoots by about one interval of traffic
      and results["sync"]["wrongly_rejected"] == 0
      and budgeted["attempts"] <= REQUESTS + REQUESTS // RETRY_COST and unlimited["attempts"] > 2 * REQUESTS)
if not ok:
    raise SystemExit(1)
