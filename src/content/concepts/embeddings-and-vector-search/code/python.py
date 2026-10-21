# A tiny IVF (inverted file) index over 2D points: k-means-lite lists, nprobe search, recall vs brute force.
# Integer maths and a seeded LCG keep the output identical in every language.
import sys

SEED = 12345
seed = SEED


def rnd():
    """Park-Miller "minimal standard" LCG (MINSTD): multiplier 48271, modulus 2^31 - 1."""
    global seed
    seed = (seed * 48271) % 2147483647
    return seed


N, CLUSTERS, NLIST, K, Q = 2000, 24, 32, 10, 40
CENTER_MIN, CENTER_SPREAD = 1000, 8000  # cluster centres lie in [1000, 9000)
JITTER_RANGE = 1600
JITTER_CENTER = 3 * JITTER_RANGE // 2  # sum of three draws in 0..1600, centred on 0
KMEANS_ROUNDS = 6
ID_SLOTS = 4096  # a candidate packs distance * ID_SLOTS + id; N must stay below it
FILTER_TAG = 3
cx, cy = [], []
for _ in range(CLUSTERS):
    cx.append(rnd() % CENTER_SPREAD + CENTER_MIN)
    cy.append(rnd() % CENTER_SPREAD + CENTER_MIN)


def jitter():
    a = rnd() % (JITTER_RANGE + 1)
    b = rnd() % (JITTER_RANGE + 1)
    c = rnd() % (JITTER_RANGE + 1)
    return a + b + c - JITTER_CENTER


px, py, tag = [], [], []
for i in range(N):
    t = i % CLUSTERS
    tag.append(t)
    px.append(cx[t] + jitter())
    py.append(cy[t] + jitter())
qs = []
for _ in range(Q):
    t = rnd() % CLUSTERS
    qs.append((cx[t] + jitter(), cy[t] + jitter()))


def d2(ax, ay, bx, by):
    return (ax - bx) * (ax - bx) + (ay - by) * (ay - by)


# Build: Lloyd's k-means for 6 rounds, starting from evenly spaced points.
mx = [px[c * N // NLIST] for c in range(NLIST)]
my = [py[c * N // NLIST] for c in range(NLIST)]


def nearest(x, y):
    b, bd = 0, d2(x, y, mx[0], my[0])
    for c in range(1, NLIST):
        d = d2(x, y, mx[c], my[c])
        if d < bd:
            bd, b = d, c
    return b


for _ in range(KMEANS_ROUNDS):
    assign = [nearest(px[i], py[i]) for i in range(N)]
    sx, sy, n = [0] * NLIST, [0] * NLIST, [0] * NLIST
    for i, c in enumerate(assign):
        sx[c] += px[i]
        sy[c] += py[i]
        n[c] += 1
    for c in range(NLIST):
        if n[c] > 0:
            mx[c], my[c] = sx[c] // n[c], sy[c] // n[c]
assign = [nearest(px[i], py[i]) for i in range(N)]
lists = [[] for _ in range(NLIST)]
for i, c in enumerate(assign):
    lists[c].append(i)


# Search: rank centroids, scan the nprobe closest lists, keep the K best. filter < 0 means no metadata filter.
def search(q, nprobe, filt, everything):
    order = sorted(range(NLIST), key=lambda c: (d2(q[0], q[1], mx[c], my[c]), c))
    ids = list(range(N)) if everything else [i for c in order[:nprobe] for i in lists[c]]
    cand, work = [], 0
    for i in ids:
        if filt < 0 or tag[i] == filt:
            work += 1
            cand.append(d2(q[0], q[1], px[i], py[i]) * ID_SLOTS + i)
    cand.sort()
    return [v % ID_SLOTS for v in cand[:K]], work + (0 if everything else NLIST)


def run(nprobe, filt, post):
    hits = work = returned = 0
    for q in qs:
        truth = set(search(q, 0, filt, True)[0])
        top, w = search(q, nprobe, -1 if post else filt, False)
        if post:
            top = [i for i in top if tag[i] == filt]
        work += w
        returned += len(top)
        hits += sum(1 for i in top if i in truth)
    return hits, Q * K, work // Q, returned


print(f"points={N} lists={NLIST} sizes={','.join(str(len(l)) for l in lists)}")
prev = None
for p in [1, 2, 4, 8, 32]:
    hits, total, avg, _ = run(p, -1, False)
    print(f"nprobe={p} recall@{K}={hits}/{total} ({hits * 100 // total}%) distance computations per query={avg} (brute force {N})")
    if prev and (hits < prev[0] or avg < prev[1]):
        sys.exit(1)
    prev = (hits, avg, total)
if prev[0] != prev[2]:
    sys.exit(1)  # probing every list is exact
for p in [1, 4, 32]:
    pre, post = run(p, FILTER_TAG, False), run(p, FILTER_TAG, True)
    print(f"filter tag=3 nprobe={p}: pre-filter recall={pre[0] * 100 // pre[1]}% post-filter recall={post[0] * 100 // post[1]}% post-filter results returned={post[3]}/{post[1]}")
# Memory: 10M vectors of 768 dimensions.
V, D, MB = 10000000, 768, 1000000
FLOAT32_BYTES, PQ_BYTES = 4, 96
print(f"float32 {V * D * FLOAT32_BYTES // MB} MB, int8 {V * D // MB} MB, product quantisation (96 bytes per vector) {V * PQ_BYTES // MB} MB")
