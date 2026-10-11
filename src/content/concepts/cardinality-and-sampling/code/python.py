# Cost of labels and sampling: series cardinality, head vs tail sampling, and reweighted estimators.
# Integer-only random numbers so the output is identical in every language.
import math

M = 0xFFFFFFFF
N = 100000        # 2 seconds of traffic at 50,000 requests per second
SLOW_MS = 800     # tail sampling keeps anything at least this slow
SEED = 5


def mix(x):  # 32-bit hash finalizer (murmur3)
    x = ((x ^ (x >> 16)) * 0x85EBCA6B) & M
    x = ((x ^ (x >> 13)) * 0xC2B2AE35) & M
    return (x ^ (x >> 16)) & M


def mulberry32(seed):
    a = seed & M

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & M
        t = ((a ^ (a >> 15)) * (1 | a)) & M
        t = ((t + ((t ^ (t >> 7)) * (61 | t))) & M) ^ t
        return (t ^ (t >> 14)) & M
    return nxt


def make_stream(n, seed):  # 0.2% errors (slow timeouts), 1% slow successes, the rest fast
    rng, out = mulberry32(seed), []
    for _ in range(n):
        id_, u = rng(), rng() % 100000
        err = False
        if u < 200:
            err = True
            ms = 1500 + rng() % 2500
        elif u < 1200:
            ms = SLOW_MS + rng() % 2200
        else:
            ms = 20 + rng() % 60 + rng() % 60 + rng() % 60
        out.append((id_, err, ms))
    return out


# Head sampling: a pure function of the trace id, so every service decides the same way.
def head_keep(id_, d, salt=0x9E3779B9):
    return mix((id_ ^ salt) & M) < 4294967296 // d


def interesting(e):
    return e[1] or e[2] >= SLOW_MS


def weighted_quantile(items, pct):  # items: (ms, weight); smallest ms with >= pct% of the weight below
    items = sorted(items, key=lambda x: x[0])
    total, cum = sum(w for _, w in items), 0
    for ms, w in items:
        cum += w
        if cum * 100 >= pct * total:
            return ms


def wilson(k, n):  # 95% interval for a proportion
    z, p = 1.96, k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
    return c - h, c + h


stream = make_stream(N, SEED)
true_errors = sum(1 for e in stream if e[1])
print(f"stream: {N} requests, {true_errors} errors, true p99 {weighted_quantile([(e[2], 1) for e in stream], 99)} ms")


def run(d, tail):
    kept = [e for e in stream if head_keep(e[0], d) or (tail and interesting(e))]
    errs_kept = sum(1 for e in kept if e[1])
    weight = lambda e: 1 if (tail and interesting(e)) else d  # each kept event stands for 1/rate events
    est_total = sum(weight(e) for e in kept)
    normal_kept = sum(1 for e in kept if not (tail and interesting(e)))
    se = math.sqrt(normal_kept * d * (d - 1))  # std dev of the reweighted total
    p99 = weighted_quantile([(e[2], weight(e)) for e in kept], 99)
    naive = weighted_quantile([(e[2], 1) for e in kept], 99)
    rel_err = (est_total - N) / N * 100
    if tail:
        rate = errs_kept / est_total  # errors are exact, only the denominator is estimated
        ci = (errs_kept / (est_total + 1.96 * se), errs_kept / (est_total - 1.96 * se))
    else:
        rate = errs_kept / len(kept) if kept else 0
        ci = wilson(errs_kept, len(kept))
    pc = lambda x: f"{x * 100:.3f}"
    print(f"{'tail' if tail else 'head'} 1/{d}: kept {len(kept)}, errors kept {errs_kept}/{true_errors}, count est {est_total} ({rel_err:.2f}%), "
          f"error rate {pc(rate)}% [{pc(ci[0])}, {pc(ci[1])}], p99 {p99} ms, unweighted p99 {naive} ms")
    return errs_kept, est_total, se


for d in (1, 10, 100, 1000):
    errs, est, se = run(d, False)
    if abs(est - N) > 4 * se:
        raise SystemExit(f"head 1/{d} count estimate off")
    if d == 1 and errs != true_errors:
        raise SystemExit("keep-everything must keep every error")
for d in (10, 100, 1000):
    errs, est, se = run(d, True)
    if errs != true_errors:
        raise SystemExit("tail sampling lost an error")
    if abs(est - N) > 4 * se:
        raise SystemExit(f"tail 1/{d} count estimate off")

# Three services on the request path, each deciding at 1/10.
consistent = sum(1 for e in stream if head_keep(e[0], 10) and head_keep(e[0], 10) and head_keep(e[0], 10))
independent = sum(1 for e in stream if head_keep(e[0], 10, 1) and head_keep(e[0], 10, 2) and head_keep(e[0], 10, 3))
print(f"complete traces across 3 services at 1/10: by trace id {consistent}, independent coins {independent}")
if consistent <= independent:
    raise SystemExit("consistent sampling must keep more complete traces")

# Metric cardinality: one series per unique label combination.
labels = {"route": 20, "status": 5, "region": 6, "customer_id": 1000000}
SERIES_BYTES = 3072  # about 3 KB of memory per active series


def series(names):
    p = 1
    for n in names:
        p *= labels[n]
    return p


for names in (["route", "status"], ["route", "status", "region"], ["route", "status", "region", "customer_id"]):
    s = series(names)
    print(f"labels {'+'.join(names)}: {s} series, {s * SERIES_BYTES / 1e9:.2f} GB")
if series(["route", "status", "region"]) != 600:
    raise SystemExit("cardinality is the product")
print("ok")
