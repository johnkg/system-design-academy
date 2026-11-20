# Product search for a store, four hours: how price and stock changes reach the search index, how the index is
# sharded, and how results are ranked. 2,000 sample listings stand for a catalog of 50 million (each sample listing
# is 25,000 real ones), so counts of changes are scaled up while shares and ranks are measured on the sample.
# Every rate and cost below is an assumption of the model, not a measurement. Everything is an integer, so the output never changes.
END_MIN, FROM_MIN = 240, 60          # minutes simulated; shoppers are measured from minute 60 on
N, SCALE = 2000, 25000               # sample listings, and real listings each one stands for
QUERIES_PER_MIN, CAND, TOP = 30, 40, 10  # sample searches a minute, candidates per search, results shown
PRICE_PPM, COUNT_PPM, OUT_PPM, BACK_PPM = 2400, 3000, 1000, 10000  # per listing per minute, parts per million; busy listings change more
STORM_FROM, STORM_TO, STORM_X = 120, 180, 3  # a flash sale reprices items three times as often
NEW_PER_MIN = 6000                   # new listings and text edits a minute, in the real catalog
DOCS_PER_SHARD = 1400                # whole documents one shard copy can write a second, at a long refresh interval
INDEX_S, SIDE_S = 1, 1               # seconds to analyse and write a document; to write the side store
QPS, CORES = 20000, 32               # searches a second at peak; cores in each search node
W_US, F_US, FETCH_US, SIDE_US = 8000, 1000, 3000, 4000  # microseconds: whole-index work, fixed work per shard, merge and fetch, side lookup
SALES_CAP, NEW_BOOST = 30, 25        # the tuned mix: sales can add at most 30 points, a new listing gets 25
IDX_SHARE = 50                       # share of a node's CPU that indexing may take
TAIL = {4: 599, 8: 668, 16: 738, 32: 807}  # ln(100 x shards) x 100: the 99th percentile of the slowest of n shards
DISC = [1000, 631, 500, 431, 387, 356, 333, 315, 301, 289]  # 1000 / log2(position + 1)

seed = 0


def rnd(n):
    global seed
    seed = (seed * 48271) % 2147483647
    return seed % n


def cube(x):
    return (x * x * x) // 10000000  # 0 to 99, most listings near 0: a few best sellers


def catalog():
    global seed
    seed = 11
    sales, oos = [], []
    for i in range(N):
        x = rnd(1000)
        sales.append(0 if i % 10 == 3 else cube(x))  # every tenth listing is new, with no sales yet
    for i in range(N):
        oos.append(rnd(100) < 2 + sales[i] // 5)
    return sales, oos


def changes(sales, start_oos, storm):
    """The stream of changes to the sample listings: price changes, stock counts going down, sell-outs and restocks."""
    global seed
    seed = 23
    oos = list(start_oos)
    ev, per_min = [], [0] * END_MIN
    for m in range(END_MIN):
        x = STORM_X if storm and STORM_FROM <= m < STORM_TO else 1
        for i in range(N):
            r = rnd(1000000)
            w = 10 + sales[i]
            price, count, out = (PRICE_PPM * w * x) // 35, (COUNT_PPM * w) // 35, (OUT_PPM * w) // 35
            kind = ""
            if oos[i]:
                if r < BACK_PPM:
                    kind = "back"
                elif r < BACK_PPM + price:
                    kind = "price"
            elif r < price:
                kind = "price"
            elif r < price + count:
                kind = "count"
            elif r < price + count + out:
                kind = "out"
            if not kind:
                continue
            if kind == "out":
                oos[i] = True
            if kind == "back":
                oos[i] = False
            ev.append({"m": m, "te": m * 60 + rnd(59), "i": i, "kind": kind, "ve": 0, "n": len(ev)})
            per_min[m] += 1
    return ev, per_min


def judged():
    """12 broad "head" queries and 12 specific "tail" ones, 30 candidates each, graded 0 to 3.
    Head queries: many listings match about equally, and what shoppers buy is a good signal. Tail queries: a few
    listings match exactly (two of them brand new) and some best sellers match only loosely."""
    global seed
    seed = 4242
    out = []
    for q in range(24):
        head = q < 12
        cands = []
        for j in range(30):
            fresh = j % 15 == 7 if head else j in (1, 2)
            s = 0 if fresh else cube(rnd(1000))
            if head:
                t = 60 + rnd(36)
                quality = t + s // 2 + rnd(21) - 10
                g = 3 if quality >= 115 else 2 if quality >= 100 else 1 if quality >= 85 else 0
            else:
                t = 85 + rnd(16) if j < 3 else 40 + rnd(21) if j < 9 else 20 + rnd(51)
                if 3 <= j < 9:
                    s = 80 + rnd(20)
                g = 3 if t >= 85 else 2 if t >= 70 else 1 if t >= 50 else 0
            cands.append({"t": t, "s": s, "g": g, "fresh": fresh, "oos": rnd(100) < 2 + s // 5})
        out.append((head, cands))
    return out


def key(mix, t, s, fresh):
    """The score a ranking mix gives a listing from its text score t, its sales score s and whether it is new."""
    if mix == "text":
        return t
    if mix == "tuned":
        return 2 * t + min(s, SALES_CAP) + (NEW_BOOST if fresh else 0)
    return 2 * t + s


def relevance(mix):
    head = tail = 0
    for is_head, cands in judged():
        def gain(c):
            return 0 if c["oos"] else (1 << c["g"]) - 1  # a result nobody can buy earns nothing

        def dcg(lst):
            return sum(gain(c) * DISC[p] for p, c in enumerate(lst[:TOP]))

        pool = [c for c in cands if not c["oos"]] if mix not in ("text", "sales") else cands
        ranked = sorted(enumerate(pool), key=lambda kc: (-key(mix, kc[1]["t"], kc[1]["s"], kc[1]["fresh"]), kc[0]))
        ideal = sorted(cands, key=lambda c: -gain(c))
        score = (dcg([c for _, c in ranked]) * 100) // max(1, dcg(ideal))
        if is_head:
            head += score
        else:
            tail += score
    return head // 12, tail // 12, (head + tail) // 24


def tenths(n):
    return f"{n // 10}.{n % 10}"


def run(name, path, refresh, shards, replicas, mix, storm):
    global seed
    sales, start_oos = catalog()
    ev, per_min = changes(sales, start_oos, storm)
    copies = 1 + replicas
    cap = (shards * DOCS_PER_SHARD * (refresh + 3)) // (refresh + 6)  # whole documents a second the shards can write, one copy each
    busy, done, lag = [0] * END_MIN, [0] * END_MIN, [0] * END_MIN
    batches = []
    if path == "batch":
        # every hour all listings changed since the last export are re-indexed in one go, and the new index opens when that ends
        prev_end, exported = 0, -1
        for k in range(1, 5):
            start = max(3600 * k, prev_end)
            dirty = {e["i"] for e in ev if exported < e["te"] <= start}
            total = len(dirty) * SCALE + NEW_PER_MIN * 60
            end = start + -(-total // cap)
            for e in ev:
                if exported < e["te"] <= start:
                    e["ve"] = end
            batches.append((start, end))
            exported, prev_end = start, end
        for m in range(END_MIN):
            secs = sum(max(0, min(b[1], m * 60 + 60) - max(b[0], m * 60)) for b in batches)
            busy[m] = (secs * 100) // 60
            done[m] = secs * cap
    else:
        # a queue in front of the indexer: changes wait when they arrive faster than the shards can write
        backlog = 0
        arrivals = [(n * SCALE if path == "nrt" else 0) + NEW_PER_MIN for n in per_min]
        room = cap * 60
        raw = []
        for m in range(END_MIN):
            take = min(backlog + arrivals[m], room)
            raw.append(min(100, ((backlog + arrivals[m]) * 100) // room))
            total = 0  # searches feel indexing over minutes, not seconds: the load is the average of the last ten minutes
            for k in range(max(0, m - 9), m + 1):
                total += raw[k]
            busy[m] = total // (m - max(0, m - 9) + 1)
            done[m] = take
            backlog = backlog + arrivals[m] - take
            lag[m] = -(-backlog // cap)
        last = [0] * N  # one listing's changes stay in order
        for e in ev:
            ve = e["te"] + SIDE_S if path == "side" else -(-(e["te"] + INDEX_S + lag[e["m"]]) // refresh) * refresh
            ve = max(ve, last[e["i"]])
            last[e["i"]] = ve
            e["ve"] = ve
    # how long a new listing takes to become searchable (60 listings created through the window); new listings always go through the index
    waited = 0
    for k in range(60):
        te = 3600 + k * 170 + (k * 37) % 60
        m = te // 60
        if path == "batch":
            ve = next(b[1] for b in batches if b[0] >= te)
        else:
            ve = -(-(te + INDEX_S + lag[m]) // refresh) * refresh
        waited += ve - te
    # the shoppers: what they see against what is true at the end of each minute
    truth, view, price_ve, pend = list(start_oos), list(start_oos), [0] * N, []
    shown = bad_price = bad_stock = bad_any = at = 0
    perm = list(range(N))
    seed = 99
    for m in range(END_MIN):
        while at < len(ev) and ev[at]["m"] == m:
            e = ev[at]
            at += 1
            if e["kind"] == "out":
                truth[e["i"]] = True
            if e["kind"] == "back":
                truth[e["i"]] = False
            if e["kind"] == "price":
                price_ve[e["i"]] = e["ve"]
            if e["kind"] in ("out", "back"):
                pend.append(e)
        tq = m * 60 + 59
        pend.sort(key=lambda e: (e["ve"], e["n"]))
        while pend and pend[0]["ve"] <= tq:
            e = pend.pop(0)
            view[e["i"]] = e["kind"] == "out"
        if m < FROM_MIN:
            continue
        for _ in range(QUERIES_PER_MIN):
            lst = []
            for j in range(CAND):
                k = j + rnd(N - j)
                perm[j], perm[k] = perm[k], perm[j]
                lst.append({"i": perm[j], "t": rnd(100), "j": j})
            pool = [c for c in lst if not view[c["i"]]] if mix not in ("text", "sales") else lst  # the filter trusts what the index (or side store) says
            pool.sort(key=lambda c: (-key(mix, c["t"], sales[c["i"]], c["i"] % 10 == 3), c["j"]))
            for c in pool[:TOP]:
                stale, gone = price_ve[c["i"]] > tq, truth[c["i"]]
                shown += 1
                bad_price += stale
                bad_stock += gone
                bad_any += stale or gone
    # the slowest minute for searches, and how many documents the shards re-index
    worst = peak_docs = sum_docs = 0
    s_us = (((W_US // shards) + F_US) * (100 + 40 // refresh)) // 100
    for m in range(FROM_MIN, END_MIN):
        rho = min(98, (QPS * s_us * 100) // (1000000 * copies * CORES) + (IDX_SHARE * busy[m]) // 100)
        mean = s_us + (s_us * rho * rho) // (100 * (100 - rho))
        p99 = (mean * TAIL[shards]) // 100 + FETCH_US + (SIDE_US if path == "side" else 0)
        worst = max(worst, p99)
        peak_docs = max(peak_docs, done[m] // 60)
        sum_docs += done[m]
    head, tail, overall = relevance(mix)
    behind = "up to an hour" if path == "batch" else f"{lag[END_MIN - 1]} s"
    print(f"-- {name}")
    print(f"  results showing a stale price or no stock: {tenths(bad_any * 1000 // shown)}% (stale price {tenths(bad_price * 1000 // shown)}%, out of stock {tenths(bad_stock * 1000 // shown)}%) of {shown}")
    print(f"  slowest minute p99 {worst // 1000} ms; documents re-indexed per second: peak {peak_docs * copies}, average {(sum_docs * copies) // ((END_MIN - FROM_MIN) * 60)}, capacity {cap * copies}; index behind by {behind} at the end")
    print(f"  new listing searchable after {waited // 60} s; relevance {overall} (head {head}, tail {tail})")


base = {"path": "batch", "refresh": 5, "shards": 8, "replicas": 2, "mix": "text", "storm": False}
run("hourly batch", **base)
run("near real time, all fields", **{**base, "path": "nrt"})
run("near real time, all fields, 1 s refresh, flash sale", **{**base, "path": "nrt", "refresh": 1, "storm": True})
run("near real time, price and stock on the side", **{**base, "path": "side", "refresh": 1, "storm": True})
run("side lookups, text and sales", **{**base, "path": "side", "mix": "sales"})
run("side lookups, text, sales and stock filter", **{**base, "path": "side", "mix": "stock"})
run("hourly batch, text, sales and stock filter", **{**base, "mix": "stock"})
run("side lookups, capped sales, new boost and stock filter", **{**base, "path": "side", "mix": "tuned"})
