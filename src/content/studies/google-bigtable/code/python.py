# A miniature of one Bigtable tablet from the Bigtable paper (OSDI 2006), in Python (a teaching model, not Google's code):
# every write goes to a commit log and then to an in-memory sorted buffer (the memtable). A full memtable becomes an immutable
# SSTable (a minor compaction). Reads merge the memtable and the SSTables, newest first, and a Bloom filter lets a read skip
# SSTables that cannot hold a row. A crash loses the memtable, which is rebuilt from the log. A major compaction rewrites
# everything into one SSTable and drops deletions. Everything is deterministic.

MEMTABLE_LIMIT = 3  # entries in the memtable before it is written out
BLOOM_BITS = 16


def bloom_bits(row):  # two cheap hash functions over the row key
    total = sum(ord(ch) for ch in row)
    return [total % BLOOM_BITS, (total * 7 + 3) % BLOOM_BITS]


def make_bloom(rows):
    bloom = [False] * BLOOM_BITS
    for e in rows:
        for b in bloom_bits(e["row"]):
            bloom[b] = True
    return bloom


tablet = {"log": [], "redo": 0, "memtable": {}, "sstables": [], "clock": 0}


def write(row, value):  # value None means a deletion marker
    tablet["clock"] += 1
    entry = {"row": row, "value": value, "ts": tablet["clock"]}
    tablet["log"].append(entry)  # 1. commit log (GFS in the paper)
    tablet["memtable"][row] = entry  # 2. memtable
    if len(tablet["memtable"]) >= MEMTABLE_LIMIT:
        minor_compaction()


def minor_compaction():
    rows = sorted(tablet["memtable"].values(), key=lambda e: e["row"])  # SSTables are sorted by row key
    tablet["sstables"].insert(0, {"rows": rows, "bloom": make_bloom(rows)})  # newest first
    tablet["memtable"] = {}
    tablet["redo"] = len(tablet["log"])  # the log before this point is no longer needed for recovery
    print(f"minor compaction: memtable became SSTable #{len(tablet['sstables'])} with {len(rows)} entries")


def report(row, entry, touched, skipped):
    shown = "not found" if entry is None else "deleted" if entry["value"] is None else entry["value"]
    print(f"read {row}: {shown} (read {touched} SSTable{'' if touched == 1 else 's'}, Bloom filter skipped {skipped})")


def read(row):
    if row in tablet["memtable"]:
        return report(row, tablet["memtable"][row], 0, 0)
    touched = skipped = 0
    for table in tablet["sstables"]:
        if not all(table["bloom"][b] for b in bloom_bits(row)):  # the filter says the row is not here
            skipped += 1
            continue
        touched += 1
        hit = next((e for e in table["rows"] if e["row"] == row), None)
        if hit:
            return report(row, hit, touched, skipped)
    return report(row, None, touched, skipped)


def crash_and_recover():
    lost = len(tablet["memtable"])
    tablet["memtable"] = {}  # the memtable lived only in memory
    for e in tablet["log"][tablet["redo"]:]:  # replay the log from the redo point
        tablet["memtable"][e["row"]] = e
    replayed = len(tablet["log"]) - tablet["redo"]
    print(f"crash: lost {lost} memtable entries, replayed {replayed} from the log, memtable has {len(tablet['memtable'])}")


def major_compaction():
    before = sum(len(t["rows"]) for t in tablet["sstables"])
    tables = len(tablet["sstables"])
    newest = {}
    for table in reversed(tablet["sstables"]):
        for e in table["rows"]:
            newest[e["row"]] = e  # newer entries replace older
    rows = sorted((e for e in newest.values() if e["value"] is not None), key=lambda e: e["row"])
    tablet["sstables"] = [{"rows": rows, "bloom": make_bloom(rows)}]
    print(f"major compaction: {before} entries in {tables} SSTables became {len(rows)} entries in 1 SSTable, deletions gone")


# Row keys are reversed host names, so pages of one site sort next to each other.
write("com.cnn.www/index.html", "<html>cnn v1")
write("com.cnn.www/world", "<html>world v1")
write("com.google.maps/index.html", "<html>maps v1")
write("com.cnn.www/index.html", "<html>cnn v2")
write("com.cnn.www/world", None)
write("org.apache.www/index.html", "<html>apache v1")
read("com.cnn.www/index.html")
read("com.cnn.www/world")
read("org.apache.www/index.html")
read("org.example.www/index.html")
write("org.wikipedia.www/index.html", "<html>wiki v1")
crash_and_recover()
read("org.wikipedia.www/index.html")
major_compaction()
read("com.cnn.www/world")
