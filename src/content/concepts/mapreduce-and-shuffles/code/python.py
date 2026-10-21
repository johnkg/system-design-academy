# A miniature MapReduce: map, optional combiner, hash-partitioned shuffle, sort, reduce. Then a hot-key skew demo with salting.

def fnv1a(s):  # 32-bit FNV-1a: stable across languages, unlike built-in hash codes
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def map_phase(split, use_combiner):
    out = [(w, 1) for line in split for w in line.split(" ")]  # map: emit (word, 1)
    if not use_combiner:
        return out
    local = {}  # combiner: pre-sum inside the mapper, before anything crosses the network
    for w, n in out:
        local[w] = local.get(w, 0) + n
    return list(local.items())


def shuffle(map_outputs, reducers):
    buckets = [[] for _ in range(reducers)]
    for records in map_outputs:
        for k, v in records:
            buckets[fnv1a(k) % reducers].append((k, v))
    return buckets


def reduce_phase(bucket):
    result = {}
    for k, v in sorted(bucket, key=lambda kv: kv[0]):  # reducers see keys in sorted order
        result[k] = result.get(k, 0) + v
    return result


splits = [
    ["the cat sat on the mat", "the dog sat on the log"],
    ["the cat saw the dog", "the dog saw the cat"],
    ["a cat and a dog sat", "on the mat and the log"],
]
R = 3
totals = {}
for combiner in (False, True):
    outputs = [map_phase(s, combiner) for s in splits]
    buckets = shuffle(outputs, R)
    merged = {}
    for b in buckets:
        merged.update(reduce_phase(b))
    shuffled = sum(len(b) for b in buckets)
    print(f"combiner={str(combiner).lower()}: shuffled {shuffled} records, per reducer [{', '.join(str(len(b)) for b in buckets)}]")
    totals[combiner] = " ".join(f"{k}={v}" for k, v in sorted(merged.items()))
print(totals[True])
if totals[True] != totals[False]:
    raise SystemExit("combiner changed the answer")

# Skew: 2000 events, half of them for one hot key. One reducer gets the hot key and becomes the straggler.
EVENTS, COLD_USERS, SEED = 2000, 50, 12345
SALT_BUCKETS = R * 2  # the hot key is split over this many salted keys
seed = SEED


def rand(n):
    """Linear congruential generator (Numerical Recipes constants)."""
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 8) % n


events = ["hot" if i % 2 == 0 else "user" + str(rand(COLD_USERS)) for i in range(EVENTS)]


def ratio(l):
    h = max(l) * R * 100 // EVENTS
    return f"{h // 100}.{h % 100:02d}"


def load(key_of):
    l = [0] * R
    for e in events:
        l[fnv1a(key_of(e)) % R] += 1
    return l


plain = load(lambda e: e)
salted = load(lambda e: "hot#" + str(rand(SALT_BUCKETS)) if e == "hot" else e)  # stage 1: spread the hot key over 6 salted keys
print(f"plain  load [{', '.join(map(str, plain))}] slowest/average = {ratio(plain)}")
print(f"salted load [{', '.join(map(str, salted))}] slowest/average = {ratio(salted)}")
print("stage 2 merges the 6 partial counts of 'hot' into one number (tiny shuffle)")
if sum(plain) != EVENTS or sum(salted) != EVENTS:
    raise SystemExit("records lost")
