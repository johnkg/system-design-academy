# Probabilistic data structures for a web crawler: a Bloom filter for "seen this URL?", HyperLogLog for "how many distinct
# URLs did the shards find?" and a count-min sketch for "which hosts get the most links?". Deterministic: fixed hashes, no randomness.
import math

N_URLS, TEST_URLS, TARGET_FP, URL_BYTES = 10000, 20000, 0.01, 100
HLL_BITS, SHARDS, DISTINCT = 14, 4, 200000
CM_ROWS, CM_WIDTH, HOSTS, TOP_LINKS = 4, 272, 1000, 20000  # width = e / 0.01, so the error is at most 1% of all links
GOLDEN = 0x9E3779B9
MASK = 0xFFFFFFFF


def fnv1a(s):
    """32-bit FNV-1a over the URL's characters (all ASCII)."""
    h = 0x811C9DC5
    for ch in s:
        h = ((h ^ ord(ch)) * 0x01000193) & MASK
    return h


def fmix(h):
    """The MurmurHash3 finalizer, to spread the bits."""
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & MASK
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & MASK
    return h ^ (h >> 16)


def hash_i(h, i):
    return fmix((h + (i + 1) * GOLDEN) & MASK)  # the i-th of several hashes of one key


def url(i):
    return f"https://site{i % 500}.example/page/{i}"


def pct(x):
    return f"{100 * x:.2f}%"


# --- Bloom filter: m bits, k hashes. "Definitely new" if any bit is 0, "probably seen" if all are 1.
class Bloom:
    def __init__(self, m, k):
        self.m, self.k, self.bits = m, k, bytearray(m)

    def add(self, key):
        h = fnv1a(key)
        for i in range(self.k):
            self.bits[hash_i(h, i) % self.m] = 1

    def might_contain(self, key):
        h = fnv1a(key)
        for i in range(self.k):
            if not self.bits[hash_i(h, i) % self.m]:
                return False  # a 0 bit: never added
        return True


def bloom_run(n, m, k):
    f = Bloom(m, k)
    for i in range(n):
        f.add(url(i))
    fn = sum(1 for i in range(n) if not f.might_contain(url(i)))
    fp = sum(1 for i in range(TEST_URLS) if f.might_contain(url(1000000 + i)))  # URLs that were never added
    return fn, fp, math.pow(1 - math.exp(-k * n / m), k)


m = math.ceil(-N_URLS * math.log(TARGET_FP) / (math.log(2) * math.log(2)))  # m = -n ln p / (ln 2)^2
k = round(m / N_URLS * math.log(2))  # k = (m / n) ln 2
fn, fp, formula = bloom_run(N_URLS, m, k)
print(f"Bloom filter: {N_URLS} URLs, m={m} bits ({math.ceil(m / 8)} bytes, {m / N_URLS:.2f} bits per URL), k={k}")
print(f"  exact set would be about {N_URLS * URL_BYTES} bytes ({URL_BYTES} bytes per URL)")
print(f"  false negatives: {fn} of {N_URLS} inserted URLs")
print(f"  false positives: {fp} of {TEST_URLS} new URLs = {pct(fp / TEST_URLS)} (formula {pct(formula)})")
_, ofp, oformula = bloom_run(2 * N_URLS, m, k)  # same size, twice the planned URLs
print(f"  overfilled with {2 * N_URLS} URLs: false positives {pct(ofp / TEST_URLS)} (formula {pct(oformula)})")


# --- HyperLogLog: 2^14 registers; each keeps the longest run of leading zeros (plus one) among the hashes routed to it.
class HLL:
    def __init__(self, p):
        self.p, self.m = p, 1 << p
        self.reg = bytearray(self.m)

    def add(self, key):
        h = fmix(fnv1a(key) ^ 0x5BD1E995)
        j = h >> (32 - self.p)  # the first p bits pick the register
        rest = (h << self.p) & MASK
        rank = min(32 - rest.bit_length() + 1, 32 - self.p + 1)
        if rank > self.reg[j]:
            self.reg[j] = rank

    def merge(self, other):
        for j in range(self.m):  # max per register
            if other.reg[j] > self.reg[j]:
                self.reg[j] = other.reg[j]

    def estimate(self):
        m = self.m
        alpha = 0.7213 / (1 + 1.079 / m)
        total = 0.0
        zeros = 0
        for r in self.reg:
            total += math.pow(2, -r)
            if r == 0:
                zeros += 1
        e = alpha * m * m / total
        if e <= 2.5 * m and zeros > 0:
            e = m * math.log(m / zeros)  # small counts: linear counting
        return math.floor(e + 0.5)


shards = [HLL(HLL_BITS) for _ in range(SHARDS)]
for i in range(DISTINCT):
    shards[i % SHARDS].add(url(i))
    if i % 3 == 0:
        shards[(i + 1) % SHARDS].add(url(i))  # a third of the URLs are also found by a second shard
print(f"HyperLogLog: {1 << HLL_BITS} registers, {(1 << HLL_BITS) * 6 // 8} bytes each, standard error {pct(1.04 / math.sqrt(1 << HLL_BITS))}")
sum_of_shards = 0
for i, s in enumerate(shards):
    e = s.estimate()
    sum_of_shards += e
    print(f"  shard {i + 1}: about {e} distinct URLs")
print(f"  adding the shard counts: {sum_of_shards} (URLs found by two shards are counted twice)")
merged = HLL(HLL_BITS)
for s in shards:
    merged.merge(s)
est = merged.estimate()
print(f"  merged sketch: {est}, true {DISTINCT}, error {pct((est - DISTINCT) / DISTINCT)}")

# --- Count-min sketch: CM_ROWS rows of CM_WIDTH counters, one hash per row. The estimate is the smallest counter.
cm = [[0] * CM_WIDTH for _ in range(CM_ROWS)]


def host(j):
    return f"host{j}.example"


def true_links(j):
    return TOP_LINKS // (j + 1)  # a few hosts get most links (a Zipf-like spread)


total = 0
for j in range(HOSTS):
    h, c = fnv1a(host(j)), true_links(j)
    for r in range(CM_ROWS):
        cm[r][hash_i(h, r) % CM_WIDTH] += c  # same as adding 1 per link, c times
    total += c


def cm_estimate(name):
    h = fnv1a(name)
    return min(cm[r][hash_i(h, r) % CM_WIDTH] for r in range(CM_ROWS))


print(f"Count-min: {CM_ROWS} rows x {CM_WIDTH} counters, {total} links, error bound 1% of links = {total // 100}")
under = max_over = 0
for j in range(HOSTS):
    d = cm_estimate(host(j)) - true_links(j)
    if d < 0:
        under += 1
    max_over = max(max_over, d)
for j in (0, 1, 2, 999):
    print(f"  {host(j)}: true {true_links(j)}, estimate {cm_estimate(host(j))}")
print(f"  underestimates: {under}, largest overestimate: {max_over}")
