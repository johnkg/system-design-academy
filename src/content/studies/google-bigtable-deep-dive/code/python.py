# A miniature of the storage engine in the Bigtable paper, in Python (a teaching model, not Google's code): a write goes to a
# commit log and a memtable, a full memtable is flushed to an immutable sorted file (an SSTable), a read looks at the memtable
# and then the files from newest to oldest, a merging compaction keeps the number of files small, and a Bloom filter lets a read
# skip files that cannot hold the row. Everything is deterministic, so every run prints the same thing. All numbers are made up.
import sys

MEMTABLE_LIMIT = 3  # entries that fill a memtable
MAX_FILES = 2  # a merging compaction runs when there are more files than this
BLOOM_BITS = 64


# A tiny Bloom filter: three hashes set three bits. It can say "maybe" wrongly, but never "no" for a row that is there.
def fnv(text, seed):
    h = (0x811C9DC5 ^ seed) & 0xFFFFFFFF
    for b in text.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def bits_for(row):
    return [fnv(row, seed) % BLOOM_BITS for seed in (1, 2, 3)]


def make_filter(rows):
    return {bit for row in rows for bit in bits_for(row)}


def might_hold(bloom, row):
    return all(bit in bloom for bit in bits_for(row))


log = []  # the commit log: every mutation, in order
memtable = {}  # row -> value, the newest data
files = []  # SSTables, oldest first: {rows, filter}
seeks = 0  # file reads, to show what the filter saves
compactions = 0


def write(row, value):
    log.append((row, value))  # the log first, so a crash loses nothing
    memtable[row] = value
    if len(memtable) >= MEMTABLE_LIMIT:
        minor_compaction()


def minor_compaction():
    global memtable
    sorted_rows = dict(sorted(memtable.items()))  # an SSTable is sorted and never changes
    files.append({"rows": sorted_rows, "filter": make_filter(sorted_rows)})
    memtable = {}
    if len(files) > MAX_FILES:
        merging_compaction()


# A merging compaction reads all the files and writes one: the newest value of each row wins.
def merging_compaction():
    global files, compactions
    merged = {}
    for file in files:
        merged.update(file["rows"])
    sorted_rows = dict(sorted(merged.items()))
    files = [{"rows": sorted_rows, "filter": make_filter(sorted_rows)}]
    compactions += 1


def read(row, use_filters):
    global seeks
    if row in memtable:
        return memtable[row]
    for file in reversed(files):
        if use_filters and not might_hold(file["filter"], row):
            continue  # the filter says this file cannot have it
        seeks += 1
        if row in file["rows"]:
            return file["rows"][row]
    return None


rows = ["com.cnn.www", "com.google.maps", "org.wikipedia", "com.example", "net.apache", "com.github", "org.mozilla", "com.nytimes", "edu.mit", "gov.nasa", "org.python", "com.apple"]
print("--- writes: each one is logged, then buffered, and a full memtable becomes a file")
for i, row in enumerate(rows):
    files_before = len(files)
    write(row, f"v{i + 1}")
    if len(files) != files_before or i + 1 == len(rows):
        print(f"after write {i + 1}: {len(files)} file(s), {len(memtable)} in the memtable, {len(log)} in the log, {compactions} merging compaction(s)")
write("com.cnn.www", "v11")
print(f"rewrote com.cnn.www: the memtable has it now ({read('com.cnn.www', False)}), the file still has the old one")

print("--- reads: looking for rows that exist and rows that do not")
missing = ["org.nowhere", "com.absent", "net.missing", "edu.gone", "gov.none"]
seeks = 0
for name in missing:
    read(name, False)
seeks_without = seeks
seeks = 0
for name in missing:
    read(name, True)
seeks_with = seeks
print(f"{len(missing)} lookups for missing rows: {seeks_without} file reads without Bloom filters, {seeks_with} with them")
print(f"a lookup for com.google.maps returns {read('com.google.maps', True)}")
ok = seeks_with < seeks_without and read("com.cnn.www", True) == "v11" and len(files) <= MAX_FILES and compactions >= 1
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
