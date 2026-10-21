# A mini query planner: estimate the cost of three join methods from row counts, pick the cheapest,
# then run all three for real and compare the estimate with what happened. Integer maths only, so the output is exact.
SEQ, TUPLE, CMP, HASH, SETUP = 1000, 10, 3, 5, 1000   # cost units: one sequential page read = 1000
CUST_PER_PAGE, ORD_PER_PAGE = 40, 100
SEED, NL_ONE_IN = 7, 10  # one customer in 10 lives in NL
ROW_KEY = 1000  # a result row packs both ids: order_id * 1000 + customer_id
STALE_SHRINK = 20  # stale statistics were taken when the tables were 20x smaller
LARGE_CUST, LARGE_ORD = 1000, 20000
WRONG_PLAN_FACTOR = 5  # the stale plan must cost at least this many times the best one


def make_tables(n_cust, n_ord, presorted=False, seed=SEED):
    state = seed

    def rnd(n):  # tiny LCG, so every run (and every language) sees the same rows
        nonlocal state
        state = (state * 1664525 + 1013904223) % 4294967296
        return (state >> 8) % n

    customers = [(i, "NL" if rnd(NL_ONE_IN) == 0 else "US") for i in range(1, n_cust + 1)]
    orders = [(i, 1 + min(rnd(n_cust), rnd(n_cust))) for i in range(1, n_ord + 1)]  # skewed: low ids order more
    if presorted:  # like a table clustered on customer_id
        orders.sort(key=lambda o: (o[1], o[0]))
    return customers, orders


def pages(rows, per_page):
    return (rows + per_page - 1) // per_page


def log2_ceil(n):
    return (n - 1).bit_length() if n > 1 else 0


def estimate(method, st, p_cust, p_ord, presorted):
    """Cost from statistics only: st = (customer rows, order rows, distinct customer ids in orders, filtered customers)."""
    n_cust, n_ord, ndv, k = st
    m = k * n_ord // ndv  # estimated join output
    base = p_cust * SEQ + n_cust * TUPLE
    if method == "nested loop":
        return base + p_ord * SEQ + n_ord * TUPLE + k * n_ord * CMP
    if method == "hash join":
        return base + p_ord * SEQ + n_ord * TUPLE + (k + n_ord) * HASH + m * CMP + SETUP
    return base + p_ord * SEQ + (n_ord + k) * TUPLE + (k + n_ord + (0 if presorted else n_ord * log2_ceil(n_ord))) * CMP  # merge: sort orders first unless already sorted


def merge_sort(rows, key, c):
    if len(rows) <= 1:
        return rows
    mid = len(rows) // 2
    left, right = merge_sort(rows[:mid], key, c), merge_sort(rows[mid:], key, c)
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        c[0] += 1
        if key(right[j]) < key(left[i]):
            out.append(right[j]); j += 1
        else:
            out.append(left[i]); i += 1
    return out + left[i:] + right[j:]


def run(method, customers, orders, country, presorted):
    """Execute the join and count the work. Returns (sorted result rows, cost in units)."""
    w = {"seq": pages(len(customers), CUST_PER_PAGE) + pages(len(orders), ORD_PER_PAGE), "tuples": len(customers) + len(orders), "cmp": 0, "hash": 0, "setup": 0}
    outer = [cid for cid, ctry in customers if ctry == country]
    out = []
    if method == "nested loop":
        for cid in outer:
            for oid, ocid in orders:
                w["cmp"] += 1
                if ocid == cid:
                    out.append(oid * ROW_KEY + cid)
    elif method == "hash join":
        w["setup"] = SETUP
        table = set()
        for cid in outer:
            w["hash"] += 1; table.add(cid)
        for oid, ocid in orders:
            w["hash"] += 1
            if ocid in table:
                w["cmp"] += 1; out.append(oid * ROW_KEY + ocid)
    else:
        c = [0]
        ordered = [(ocid, oid) for oid, ocid in orders]
        if not presorted:
            ordered = merge_sort(ordered, lambda r: r[0], c)
        w["cmp"] += c[0]; w["tuples"] += len(outer)
        i = j = 0
        while i < len(outer) and j < len(ordered):
            w["cmp"] += 1
            if outer[i] < ordered[j][0]: i += 1
            elif outer[i] > ordered[j][0]: j += 1
            else: out.append(ordered[j][1] * ROW_KEY + outer[i]); j += 1
    cost = w["seq"] * SEQ + w["tuples"] * TUPLE + w["cmp"] * CMP + w["hash"] * HASH + w["setup"]
    return sorted(out), cost, w["cmp"] + w["hash"]


def checksum(rows):
    h = 0
    for v in rows:
        h = (h * 31 + v) % 1000003
    return h


METHODS = ["nested loop", "hash join", "merge join"]


def plan_and_run(label, n_cust, n_ord, stale, presorted=False):
    customers, orders = make_tables(n_cust, n_ord, presorted)
    p_c, p_o = pages(n_cust, CUST_PER_PAGE), pages(n_ord, ORD_PER_PAGE)  # page counts always come from the file size
    ndv = len({o[1] for o in orders})
    k_real = sum(1 for _, ctry in customers if ctry == "NL")
    # fresh statistics are exact; stale ones are from when the tables were 20x smaller and NL was rare (0.2%)
    st = (max(1, n_cust // STALE_SHRINK), max(1, n_ord // STALE_SHRINK), max(1, ndv // STALE_SHRINK), 1) if stale else (n_cust, n_ord, ndv, k_real)
    est = {m: estimate(m, st, p_c, p_o, presorted) for m in METHODS}
    pick = min(METHODS, key=lambda m: est[m])
    runs = {m: run(m, customers, orders, "NL", presorted) for m in METHODS}
    assert runs["nested loop"][0] == runs["hash join"][0] == runs["merge join"][0], "methods disagree"
    best = min(METHODS, key=lambda m: runs[m][1])
    print(f"{label}: {n_cust} customers, {n_ord} orders, filter matches {k_real} (planner expects {st[3]})")
    for m in METHODS:
        print(f"  {m:<11} est {est[m]:>9}  actual {runs[m][1]:>9}  compared {runs[m][2]:>8}")
    rows = runs[pick][0]
    print(f"  planner picks {pick}; cheapest in reality: {best}; {len(rows)} rows, checksum {checksum(rows)}")
    return pick, best, runs[pick][1], runs[best][1]


pick, best, _, _ = plan_and_run("tiny", 16, 60, False)
assert pick == best == "nested loop"
pick, best, _, _ = plan_and_run("large", LARGE_CUST, LARGE_ORD, False)
assert pick == best == "hash join"
pick, best, got, ideal = plan_and_run("large, stale stats", LARGE_CUST, LARGE_ORD, True)
assert pick == "nested loop" and best == "hash join" and got > WRONG_PLAN_FACTOR * ideal
pick, best, _, _ = plan_and_run("large, orders sorted by customer_id", LARGE_CUST, LARGE_ORD, False, True)
assert pick == best == "merge join"
print(f"stale statistics made the query cost {got // ideal}x more than necessary")
