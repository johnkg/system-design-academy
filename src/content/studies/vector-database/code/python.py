# A small IVF (inverted file) vector index in Python:
# k-means splits the vectors into lists, a query scans only the nearest lists, and we measure recall against an exact scan.
import sys

DIM, N, LISTS, K, QUERIES = 8, 2000, 16, 10, 50

SEED, CLUSTERS, KMEANS_ROUNDS, FILTER_NPROBE = 7, 24, 5, 2
MAX_COMPONENT, NOISE = 255, 60  # components are bytes; a vector sits within +-60 of its cluster centre
SALE_EVERY = 10                 # 10% of vectors carry the filter tag
seed = SEED


def rand(n):
    """Linear congruential generator (Numerical Recipes constants), top 24 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 8) % n


def dist(a, b):  # squared distance, integers only
    return sum((x - y) ** 2 for x, y in zip(a, b))


def near(c):
    return [min(MAX_COMPONENT, max(0, x + rand(2 * NOISE + 1) - NOISE)) for x in c]


centers = [[rand(MAX_COMPONENT + 1) for _ in range(DIM)] for _ in range(CLUSTERS)]
vectors = [near(centers[rand(CLUSTERS)]) for _ in range(N)]
tags = ["sale" if i % SALE_EVERY == 0 else "other" for i in range(N)]  # 10% of vectors carry the filter tag


def closest(v, items):
    best = 0
    for i, c in enumerate(items):
        if dist(v, c) < dist(v, items[best]):
            best = i
    return best


# Training: a few rounds of k-means with integer centroids.
cents = [list(vectors[i * (N // LISTS)]) for i in range(LISTS)]
for _ in range(KMEANS_ROUNDS):
    sums = [[0] * DIM for _ in range(LISTS)]
    counts = [0] * LISTS
    for v in vectors:
        c = closest(v, cents)
        counts[c] += 1
        for i, x in enumerate(v):
            sums[c][i] += x
    cents = [[s // counts[c] for s in sums[c]] if counts[c] else cents[c] for c in range(LISTS)]
lists = [[] for _ in range(LISTS)]
for vid, v in enumerate(vectors):
    lists[closest(v, cents)].append(vid)


def hundredths(n):  # 2 decimals without float formatting
    return f"{n // 100}.{n % 100:02d}"


def search(q, nprobe, accept=lambda i: True):
    order = [e[1] for e in sorted((dist(q, c), i) for i, c in enumerate(cents))[:nprobe]]
    hits, scanned = [], 0
    for lst in order:
        for vid in lists[lst]:
            scanned += 1
            if accept(vid):
                hits.append((dist(q, vectors[vid]), vid))
    return [h[1] for h in sorted(hits)[:K]], scanned


def exact(q, accept=lambda i: True):
    return [e[1] for e in sorted((dist(q, v), i) for i, v in enumerate(vectors) if accept(i))[:K]]


queries = [near(vectors[rand(N)]) for _ in range(QUERIES)]


def on_sale(i):
    return tags[i] == "sale"


print(f"lists hold {min(len(l) for l in lists)} to {max(len(l) for l in lists)} vectors")
last = 0
for nprobe in [1, 2, 4, 8, 16]:
    found = scanned = 0
    for q in queries:
        ids, s = search(q, nprobe)
        truth = exact(q)
        found += sum(1 for i in ids if i in truth)
        scanned += s
    recall = found * 100 // (QUERIES * K)
    print(f"nprobe {nprobe}: recall@{K} {recall}%, scans {scanned // QUERIES} of {N} vectors")
    if recall < last:
        sys.exit(1)
    last = recall
if last != 100:
    sys.exit(1)

post = during = during_hits = 0
for q in queries:
    post += sum(1 for i in search(q, FILTER_NPROBE)[0] if on_sale(i))  # filter after the search: only what is left of the top 10
    ids, _ = search(q, FILTER_NPROBE, on_sale)  # filter while scanning: the top 10 of the matching vectors
    during += len(ids)
    truth = exact(q, on_sale)
    during_hits += sum(1 for i in ids if i in truth)
print(f"filter 'sale' (10%), nprobe 2: after the search {hundredths(post * 100 // QUERIES)} results on average, during the scan {hundredths(during * 100 // QUERIES)}")
print(f"filtered recall {during_hits * 100 // during}%")
if post >= during:
    sys.exit(1)
