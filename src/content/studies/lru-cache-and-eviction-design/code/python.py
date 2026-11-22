# A cache in front of a database, tried with different eviction policies on the same 200,000 requests. 85% of the
# requests ask for 1,000 hot keys (some hotter than others) and 15% for one of 50,000 cold keys. In one variant a
# report job reads 20,000 old keys once, between request 80,000 and 120,000. In another the hot set moves to other keys
# at request 140,000. The requests come from a seeded generator, so the output never changes. Integers only.
# The model is the catalog of the case study scaled down 1 to 1,000: 1,000 hot keys stand for 1 million, 50,000 cold keys for 50 million.
from collections import OrderedDict

REQUESTS = 200000
HOT, HOT_PCT = 1000, 85                  # hot keys, and the share of requests that ask for them
COLD_BASE, COLD = 5000, 50000            # the cold keys: 5,000 up to 54,999
SHIFT_BASE = 2000                        # after the shift the hot keys are 2,000 up to 2,999
SCAN_BASE = 100000                       # keys read once by the report job
SCAN_START, SCAN_END = 80000, 120000     # the report reads one new key every second request in this window
SHIFT_AT = 140000                        # the hot set moves here
MEMORY_LIMIT = 10000                     # entries an unbounded map can hold before the process is killed
SEED = 20261121


def make_random(seed):
    """Park-Miller generator, the same in every language."""
    state = [seed]

    def next_value():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]

    return next_value


def run(name, policy="lru", size=2000, scan=False, shift=False, ttl=0):
    nxt = make_random(SEED)
    lfu = policy == "lfu"
    order = OrderedDict()    # lru, fifo and unbounded: keys from oldest to newest
    freq = {}                # lfu: how often each key was used
    buckets = {}             # lfu: use count -> keys with that count, oldest first
    born = {}                # key -> request number when it was stored
    min_freq, count, peak, restarts, evictions, expired, db_reads = 1, 0, 0, 0, 0, 0, 0
    hits, asked = [0, 0, 0, 0], [0, 0, 0, 0]  # before the scan, during it, in between, after the shift

    def oldest(m):
        return next(iter(m))

    def bucket(f):
        if f not in buckets:
            buckets[f] = OrderedDict()
        return buckets[f]

    def remove(key):
        nonlocal count
        if lfu:
            f = freq[key]
            b = buckets[f]
            del b[key]
            if not b:
                del buckets[f]
            del freq[key]
        else:
            del order[key]
        del born[key]
        count -= 1

    for i in range(REQUESTS):
        if scan and SCAN_START <= i < SCAN_END and i % 2 == 0:
            key = SCAN_BASE + (i - SCAN_START) // 2
        elif nxt() % 100 < HOT_PCT:
            base = SHIFT_BASE if shift and i >= SHIFT_AT else 0
            a = nxt() % HOT
            b = nxt() % HOT
            key = base + min(a, b)
        else:
            key = COLD_BASE + nxt() % COLD
        regular = key < SCAN_BASE
        phase = 0 if i < SCAN_START else 1 if i < SCAN_END else 2 if i < SHIFT_AT else 3

        found = key in freq if lfu else key in order
        if found and ttl > 0 and i - born[key] >= ttl:
            expired += 1
            remove(key)
            found = False
        if regular:
            asked[phase] += 1
        if found:
            if regular:
                hits[phase] += 1
            if lfu:  # move to the next use count, at the newest end of its bucket
                f = freq[key]
                bk = buckets[f]
                del bk[key]
                if not bk:
                    del buckets[f]
                    if min_freq == f:
                        min_freq = f + 1
                freq[key] = f + 1
                bucket(f + 1)[key] = True
            elif policy == "lru":
                order.move_to_end(key)  # newest end
            continue
        db_reads += 1
        if policy == "none":
            if count >= MEMORY_LIMIT:  # out of memory: restart, cache gone
                order.clear()
                born.clear()
                count = 0
                restarts += 1
        elif count >= size:
            while lfu and min_freq not in buckets:
                min_freq += 1
            remove(oldest(buckets[min_freq]) if lfu else oldest(order))
            evictions += 1
        if lfu:
            freq[key] = 1
            bucket(1)[key] = True
            min_freq = 1
        else:
            order[key] = True
        born[key] = i
        count += 1
        peak = max(peak, count)

    def pct(h, a):
        return 0 if a == 0 else h * 100 // a

    print(f"-- {name}")
    print(f"  hit rate of regular requests: {pct(sum(hits), sum(asked))}% overall; before the scan {pct(hits[0], asked[0])}%, during it {pct(hits[1], asked[1])}%, last stretch {pct(hits[3], asked[3])}%")
    print(f"  database reads: {db_reads} of {REQUESTS} requests, evictions {evictions}, expired {expired}")
    print(f"  entries: {count} at the end, {peak} at most; out-of-memory restarts {restarts}")
    if policy != "none" and peak > size:
        raise RuntimeError("cache grew past its size")


run("unbounded map, no eviction", policy="none")
run("FIFO, 2,000 entries", policy="fifo")
run("LRU, 2,000 entries")
run("LRU, 2,000 entries, report scan", scan=True)
run("LFU, 2,000 entries, report scan", policy="lfu", scan=True)
run("LFU, 1,000 entries, report scan, hot set moves", policy="lfu", size=1000, scan=True, shift=True)
run("LRU, 1,000 entries, report scan, hot set moves", size=1000, scan=True, shift=True)
run("LRU, 2,000 entries, entries expire after 2,000 requests", ttl=2000)
