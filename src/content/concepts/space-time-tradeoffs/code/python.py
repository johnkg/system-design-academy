# Space-time tradeoff: answer many range-sum queries over an array of n numbers in three ways, counting steps and memory cells.
#   recompute:   no extra memory, but every query adds up its whole range again.
#   prefix sums: one pass builds n + 1 running totals (n + 1 cells); every query is one subtraction.
#   full table:  the sum of every range stored in an n x n table (n * n cells); every query is one lookup.
# Each query asks for a range of half the array (n / 2 elements). Look for: the table's memory is quadratic, and a precomputation
# only pays off after enough queries (the break-even), and never against the prefix table here.
BYTES_PER_CELL = 8  # typically 8 bytes for a 64-bit number in a compact array; boxed objects cost more


def costs(technique, n):
    half = n // 2
    if technique == "recompute":
        return dict(build=0, per_query=half, cells=0)
    if technique == "prefix":
        return dict(build=n, per_query=1, cells=n + 1)
    return dict(build=n * n, per_query=1, cells=n * n)


def total(t, n, q):
    c = costs(t, n)
    return c["build"] + q * c["per_query"]


# Smallest number of queries at which the technique's total is below recomputing every time (0 = never).
def break_even(t, n):
    c, r = costs(t, n), costs("recompute", n)
    if c["per_query"] >= r["per_query"]:
        return 0
    q = c["build"] // (r["per_query"] - c["per_query"]) + 1
    while total(t, n, q) >= total("recompute", n, q):
        q += 1
    return q


print("-- cost model: build steps, steps per query, memory cells")
for n in [100, 1000, 10000, 100000]:
    for t in ["recompute", "prefix", "table"]:
        c = costs(t, n)
        print(f"n={n} {t}: build {c['build']}, per query {c['per_query']}, memory {c['cells']} cells")
print("-- total steps for q queries")
for n, q in [(1000, 10), (1000, 1000), (1000, 100000), (100000, 1000)]:
    print(f"n={n} q={q}: recompute {total('recompute', n, q)}, prefix {total('prefix', n, q)}, table {total('table', n, q)}")
print("-- queries needed before the precomputation beats recomputing")
for n in [100, 1000, 10000]:
    print(f"n={n}: prefix {break_even('prefix', n)}, table {break_even('table', n)}")
print(f"a table of 100000 x 100000 cells at {BYTES_PER_CELL} bytes each: {(100000 * 100000 * BYTES_PER_CELL) // 1000000000} GB")

# The model is checked against real code at a small size: the three methods give the same answers, and the counters match.
n = 50
a = [(i * 7) % 13 for i in range(n)]
queries = []
x = 99
for i in range(20):
    x = (x * 1103515245 + 12345) % 2147483648
    queries.append(x % (n - n // 2 + 1))  # start of a range of n/2 elements
steps_r = 0
answers_r = 0
for s in queries:
    for i in range(s, s + n // 2):
        answers_r += a[i]
        steps_r += 1
prefix = [0]
steps_p = 0
for i in range(n):
    prefix.append(prefix[i] + a[i])
    steps_p += 1
answers_p = 0
for s in queries:
    answers_p += prefix[s + n // 2] - prefix[s]
    steps_p += 1
table = [[0] * n for _ in range(n)]
steps_t = 0
for i in range(n):
    run = 0
    for j in range(n):
        if j >= i:
            run += a[j]
        table[i][j] = run
        steps_t += 1
answers_t = 0
for s in queries:
    answers_t += table[s][s + n // 2 - 1]
    steps_t += 1
same = "true" if answers_r == answers_p == answers_t else "false"
print(f"-- model against real code (n={n}, 20 queries): same answers {same}")
print(f"steps counted: recompute {steps_r} (model {total('recompute', n, 20)}), prefix {steps_p} (model {total('prefix', n, 20)}), table {steps_t} (model {total('table', n, 20)})")

# A cache with no eviction grows with the number of distinct keys; a cache with a cap stays bounded but gives up some hits.
requests, keys, cap = 100000, 50000, 1000
x = 12345
hits_u = hits_c = 0
unbounded, capped, order = set(), set(), []
for i in range(requests):
    x = (x * 1664525 + 1013904223) % 4294967296
    k = (x // 65536) % keys
    if k in unbounded:
        hits_u += 1
    else:
        unbounded.add(k)
    if k in capped:
        hits_c += 1
    else:
        capped.add(k)
        order.append(k)
        if len(order) > cap:
            capped.discard(order.pop(0))  # first in, first out
print(f"-- cache over {requests} requests for {keys} possible keys")
print(f"no eviction: {len(unbounded)} entries, {hits_u} hits")
print(f"capped at {cap} entries (first in, first out): {len(capped)} entries, {hits_c} hits")
