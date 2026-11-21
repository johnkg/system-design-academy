# A chained hash table with a fixed number of buckets and a selectable hash function. A probe is one key compared
# while walking a chain. Inserts check the chain for the key first, then append; lookups walk until they find it.
# Look for: a good hash keeps chains short, so a lookup costs about 1 probe; a poor or constant hash, or keys an attacker
# chose to collide, put everything in a few chains and the cost becomes O(n) per lookup, O(n^2) in total.
# The chain walks use the language's own linear scan (in / index): a scan is exactly position + 1 comparisons.
MASK = 0xFFFFFFFF
MULT = 2654435761      # Knuth's multiplicative constant (odd, so multiplying mod 2^32 is reversible)
MULT_INV = 244002641   # its inverse mod 2^32: an attacker uses it to craft colliding keys
MIX = 2246822519       # a second odd multiplier for the seeded hash's mixing steps
SEED = 2718281828      # the secret a randomised hash would pick at start-up (a fixed stand-in so the output repeats)


def bucket_of(fn, key, m):
    if fn == "constant":
        return 0
    if fn == "poor":
        return (key % 10) % m  # looks only at the last decimal digit
    if fn == "seeded":  # a keyed, better-mixed hash: a stand-in for what SipHash-style hashes do with a secret key
        x = (key ^ SEED) & MASK
        x = (x * MULT) & MASK
        x = (x ^ (x >> 15)) & MASK
        x = (x * MIX) & MASK
        x = (x ^ (x >> 13)) & MASK
        return (x >> 16) % m
    h = (key * MULT) & MASK  # multiplicative hash mod 2^32
    return (h // 65536) % m  # use the high 16 bits, which mix best


def make_keys(pattern, fn, n):
    keys = []
    x = 12345
    for i in range(n):
        if pattern == "random":
            x = (x * 1664525 + 1013904223) & MASK
            keys.append(x)
        elif pattern == "sequential":
            keys.append(i)
        elif fn == "poor":
            keys.append(i * 10)  # adversarial for a last-digit hash: every key ends in 0
        elif fn == "constant":
            keys.append(i)  # anything collides with a constant hash
        else:
            keys.append((i * MULT_INV) & MASK)  # crafted so the UNSEEDED hash of key i is i, high bits 0: bucket 0
    return keys


def run(fn, pattern, n, m):
    buckets = [[] for _ in range(m)]
    keys = make_keys(pattern, fn, n)
    insert_probes = lookup_probes = 0
    for k in keys:
        chain = buckets[bucket_of(fn, k, m)]
        if k in chain:
            raise Exception("duplicate key")
        insert_probes += len(chain)  # the walk that found no match
        chain.append(k)
    for k in keys:
        lookup_probes += buckets[bucket_of(fn, k, m)].index(k) + 1
    total = insert_probes + lookup_probes
    lens = [len(b) for b in buckets]
    if total != sum(l * l for l in lens):  # inserts l(l-1)/2 + lookups l(l+1)/2
        raise Exception("model mismatch")
    avg = (lookup_probes * 100) // n
    used = len([l for l in lens if l > 0])
    return f"longest chain {max(lens)}, buckets used {used} of {m}, {avg // 100}.{str(avg % 100).zfill(2)} probes per lookup, {total} probes in total"


scenarios = [
    ("good hash, random keys", "good", "random"),
    ("good hash, sequential keys", "good", "sequential"),
    ("poor hash (last digit), sequential keys", "poor", "sequential"),
    ("constant hash, sequential keys", "constant", "sequential"),
    ("good hash, attacker keys", "good", "adversarial"),
    ("seeded hash, attacker keys", "seeded", "adversarial"),
    ("poor hash (last digit), attacker keys", "poor", "adversarial"),
]
for n, m in [(100, 128), (10000, 16384)]:
    print(f"n={n} keys, {m} buckets (load factor {n * 100 // m}%)")
    for name, fn, pattern in scenarios:
        print(f"  {name}: {run(fn, pattern, n, m)}")
