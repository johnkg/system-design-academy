# Scatter and gather: a coordinator sends a query to every shard, each shard returns its own top (from + size) results,
# and the coordinator merges them. The query is as slow as its slowest shard. 2,000 simulated queries with a seeded
# random generator, integer milliseconds, so the output never changes.
QUERIES = 2000
BASE_MS = 20          # a shard answers in about this long when nothing goes wrong
SLOW_PER_MILLE = 5    # chance (in 1,000) that one shard request is slow (0.5%)
SLOW_MS = 200         # how much longer a slow request takes
BIG_SHARD = 3         # with uneven shards, shard 0 holds this many times the data and takes this many times as long


def make_random(seed):  # Park-Miller generator: small enough that every language computes it exactly
    state = [seed]

    def rand(n):
        state[0] = (state[0] * 48271) % 2147483647
        return state[0] % n
    return rand


# One shard request: base time (more for a bigger shard), a random spread, a rare slow spike, and the cost of collecting from + size hits.
def shard_time(rand, base, spread, depth):
    return base + rand(spread + 1) + (SLOW_MS if rand(1000) < SLOW_PER_MILLE else 0) + depth // 100


def run(shards, replicas, hedge, spread, frm, size, uneven):
    rand = make_random(12345)
    depth = frm + size
    merge = 2 + shards * depth // 1000  # the coordinator merges shards x (from + size) hits
    times = []
    slow_queries = 0
    for _ in range(QUERIES):
        worst = 0
        hit_slow = False
        for s in range(shards):
            base = BASE_MS * BIG_SHARD if uneven and s == 0 else BASE_MS
            a = shard_time(rand, base, spread, depth)
            b = shard_time(rand, base, spread, depth)  # the second replica is always drawn, so settings are compared on the same luck
            t = min(a, b) if hedge and replicas >= 2 else a
            if t >= base + SLOW_MS:
                hit_slow = True
            worst = max(worst, t)
        if hit_slow:
            slow_queries += 1
        times.append(worst + merge)
    times.sort()
    return {
        "p50": times[QUERIES * 50 // 100], "p99": times[QUERIES * 99 // 100],
        "slow_tenths": slow_queries * 1000 // QUERIES, "moved": shards * depth, "kept": size,
    }


BASE = dict(shards=8, replicas=1, hedge=False, spread=10, frm=0, size=10, uneven=False)


def show(name, **o):
    r = run(**{**BASE, **o})
    print(f"{name}: p50 {r['p50']} ms, p99 {r['p99']} ms, {r['slow_tenths'] // 10}.{r['slow_tenths'] % 10}% of queries hit a slow shard, {r['moved']} documents sent to the coordinator for {r['kept']} shown")
    return r


print("how the slowest shard decides the query (spread 10 ms, first page)")
one = show("1 shard   ", shards=1)
show("8 shards  ")
wide = show("32 shards ", shards=32)
print("send each request to two replicas and use the first answer")
show("8 shards, 2 replicas, hedged", replicas=2, hedge=True)
hedged = show("32 shards, 2 replicas, hedged", shards=32, replicas=2, hedge=True)
print("deep pagination, 8 shards (size 10)")
show("from 0     ")
show("from 1000  ", frm=1000)
deep = show("from 10000 ", frm=10000)
print("uneven shards: shard 0 holds 3 times the data")
uneven = show("8 shards, one big shard", uneven=True)
if wide["p99"] <= one["p99"] or hedged["p99"] >= wide["p99"] or deep["moved"] != 80080 or uneven["p50"] <= 60:
    raise SystemExit("impossible result")
