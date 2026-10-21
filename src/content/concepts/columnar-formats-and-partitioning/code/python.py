# A miniature columnar file writer and reader: partitions, row groups, per-chunk min/max stats and column pruning.
import sys

DAYS, ROWS_PER_DAY, RG_ROWS, PAYLOAD = 10, 300, 100, 40
COUNTRIES = ["US", "DE", "BRA", "IND", "JPN"]
SEED, USER_IDS, MAX_AMOUNT = 42, 100000, 1000  # amounts are 0..MAX_AMOUNT-1
BITS_PER_BYTE, HEADER_BYTES = 8, 8
FOOTER_SCHEMA_BYTES, CHUNK_META_BYTES, COLUMN_COUNT = 100, 48, 4  # footer: schema, then offset+stats per chunk
USER_BYTES, AMOUNT_BYTES = 4, 2  # fixed-width fields in the row format
seed = SEED


def nxt():
    """Linear congruential generator (Numerical Recipes constants)."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed


def make_rows(clustered):
    global seed
    seed = SEED
    by_day = []
    for d in range(DAYS):
        rows = []
        for i in range(ROWS_PER_DAY):
            user = nxt() % USER_IDS
            country = COUNTRIES[nxt() % len(COUNTRIES)]
            amount = nxt() % MAX_AMOUNT
            rows.append({"day": d, "user": user, "country": country, "amount": amount, "i": i})
        if clustered:
            rows.sort(key=lambda r: (r["amount"], r["i"]))  # sort inside the partition
        by_day.append(rows)
    return by_day


def bits_for(rng):
    b = 0
    while rng > 0:
        b += 1
        rng //= 2
    return b


def packed(n, bits):
    return (n * bits + BITS_PER_BYTE - 1) // BITS_PER_BYTE + HEADER_BYTES  # bit-packed values plus an 8-byte header


def encode_chunk(name, values):
    n = len(values)
    if name == "country":  # dictionary encoding: distinct strings once, then small integer codes
        dict_ = sorted(set(values))
        dict_bytes = sum(len(v) + 1 for v in dict_)
        return {"bytes": dict_bytes + packed(n, bits_for(len(dict_) - 1))}
    if name == "payload":
        return {"bytes": PAYLOAD * n + HEADER_BYTES}  # opaque blob, stored plain
    mn, mx = min(values), max(values)  # frame of reference: store (value - min) in few bits
    return {"bytes": packed(n, bits_for(mx - mn)), "min": mn, "max": mx}


def write_file(rows):  # one file per partition, split into row groups, one chunk per column
    groups = []
    for s in range(0, len(rows), RG_ROWS):
        part = rows[s:s + RG_ROWS]
        chunks = {}
        for c in ["user", "country", "amount", "payload"]:
            chunks[c] = encode_chunk(c, [0] * len(part) if c == "payload" else [r[c] for r in part])
        groups.append({"rows": part, "chunks": chunks})
    return {"groups": groups, "footer": FOOTER_SCHEMA_BYTES + CHUNK_META_BYTES * COLUMN_COUNT * len(groups)}  # schema plus every chunk's offset and stats


def row_format_bytes(rows):
    return sum(USER_BYTES + AMOUNT_BYTES + len(r["country"]) + 1 + PAYLOAD for r in rows)


# SELECT sum(amount) FROM t WHERE day >= from_day AND amount >= min_amount
def query(files, by_day, mode, from_day, min_amount, cols):
    nbytes = total = read = seen = 0
    for d in range(from_day, DAYS):  # partition pruning: days before from_day are never opened
        if mode == "row":
            nbytes += row_format_bytes(by_day[d])
            total += sum(r["amount"] for r in by_day[d] if r["amount"] >= min_amount)
            continue
        nbytes += files[d]["footer"]
        for g in files[d]["groups"]:
            seen += 1
            if mode == "stats" and g["chunks"]["amount"]["max"] < min_amount:
                continue  # min/max says no row can match
            read += 1
            for c in cols:
                nbytes += g["chunks"][c]["bytes"]  # only the requested column chunks are read
            total += sum(r["amount"] for r in g["rows"] if r["amount"] >= min_amount)
    return {"bytes": nbytes, "sum": total, "read": read, "total": seen}


for clustered in [False, True]:
    by_day = make_rows(clustered)
    files = [write_file(r) for r in by_day]
    print("data " + ("sorted by amount inside each day" if clustered else "in arrival order"))
    cases = [("all days, amount>=0", 0, 0), ("last 3 days, amount>=0", 7, 0), ("last 3 days, amount>=900", 7, 900)]
    for label, frm, mn in cases:
        r = query(files, by_day, "row", frm, mn, None)
        c = query(files, by_day, "columnar", frm, mn, ["amount"])
        s = query(files, by_day, "stats", frm, mn, ["amount"])
        if r["sum"] != c["sum"] or c["sum"] != s["sum"]:
            print("MISMATCH")
            sys.exit(1)
        pad = lambda x: str(x).rjust(6)
        print(f"  {label.ljust(26)} row {pad(r['bytes'])}  columnar {pad(c['bytes'])}  +stats {pad(s['bytes'])} ({s['read']}/{s['total']} groups)  sum {s['sum']}")
