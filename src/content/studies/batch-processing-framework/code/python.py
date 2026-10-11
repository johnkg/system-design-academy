# A tiny MapReduce job in Python: map tasks with a combiner, a hash-partitioned shuffle,
# reduce tasks, recovery of lost output by re-running only the tasks it came from, and a speculative backup for a straggler.
import sys

SPLITS, REDUCERS, PER_SPLIT, VOCAB = 8, 4, 500, 40
seed = 7


def next_value():
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return seed >> 16


def make_word():
    a = next_value() % VOCAB
    b = next_value() % VOCAB
    return "w%02d" % ((a * b) // VOCAB)


# Input splits: words with a skew, so a few words are very common.
splits = [[make_word() for _ in range(PER_SPLIT)] for _ in range(SPLITS)]


def fnv(word):
    h = 2166136261
    for c in word:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h


runs = {"map": 0, "reduce": 0}


def map_task(i):
    """Read one split and write one bucket per reducer. The combiner adds up equal words before they leave the mapper."""
    runs["map"] += 1
    buckets = [{} for _ in range(REDUCERS)]
    for w in splits[i]:
        b = buckets[fnv(w) % REDUCERS]
        b[w] = b.get(w, 0) + 1
    return buckets


def reduce_task(p, map_out):
    """Fetch this reducer's bucket from every map output and merge them."""
    runs["reduce"] += 1
    total = {}
    for out in map_out:
        for w, n in out[p].items():
            total[w] = total.get(w, 0) + n
    return total


def show(counts):
    return ",".join("%s:%d" % (w, counts[w]) for w in sorted(counts))


map_out = [map_task(i) for i in range(SPLITS)]
result = [reduce_task(p, map_out) for p in range(REDUCERS)]

shuffled = sum(len(b) for o in map_out for b in o)
load = [sum(r.values()) for r in result]
merged = {}
for r in result:
    merged.update(r)
top = sorted(merged.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
print("input: %d splits x %d words, %d reducers" % (SPLITS, PER_SPLIT, REDUCERS))
print("shuffle records: %d without a combiner, %d with it" % (SPLITS * PER_SPLIT, shuffled))
print("words per reducer: %s; distinct words: %d" % (", ".join(str(n) for n in load), len(merged)))
print("top 3: %s" % ", ".join("%s=%d" % kv for kv in top))

# Failure: reducer 2's output is lost, and so are the map outputs held by the machine that ran splits 3 and 5.
before = show(result[2])
runs["map"] = 0
runs["reduce"] = 0
map_out = [map_task(i) if i in (3, 5) else o for i, o in enumerate(map_out)]  # recompute the lost inputs from the source splits
result[2] = reduce_task(2, map_out)                                           # then only the lost partition
same = show(result[2]) == before
print("recovery: re-ran %d map tasks and %d reduce task instead of %d and %d; identical: %s"
      % (runs["map"], runs["reduce"], SPLITS, REDUCERS, "true" if same else "false"))

# Straggler: nine map tasks run at once, and one machine is slow. After 1.5 x the median time, start a backup copy elsewhere.
times = [10, 10, 11, 10, 9, 10, 45, 10, 12]
median = sorted(times)[len(times) // 2]
limit = median * 3 // 2
slowest = max(times)
with_backup = max(min(t, limit + median) if t > limit else t for t in times)
print("straggler: job takes %d without a backup, %d with a backup started at %d" % (slowest, with_backup, limit))

direct = {}
for s in splits:
    for w in s:
        direct[w] = direct.get(w, 0) + 1
if show(direct) != show(merged) or sum(load) != SPLITS * PER_SPLIT or not same or with_backup >= slowest:
    sys.exit(1)
