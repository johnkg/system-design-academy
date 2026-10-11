# A tiny LSM tree in Python: memtable, immutable sorted runs, bloom filters, tombstones and merge compaction.
# All numbers are integers so the output is identical in every language.


def fnv(key, seed):  # deterministic 32-bit FNV-1a hash, seeded
    h = (2166136261 ^ seed) & 0xFFFFFFFF
    for ch in key:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


class Bloom:
    def __init__(self, entries):
        self.bits = [False] * (entries * 10)  # 10 bits per key, 4 hashes

    def slots(self, key):
        return [fnv(key, seed) % len(self.bits) for seed in (1, 2, 3, 4)]

    def add(self, key):
        for s in self.slots(key):
            self.bits[s] = True

    def might_contain(self, key):
        return all(self.bits[s] for s in self.slots(key))


class Run:  # an immutable sorted file (SSTable): sorted keys, a bloom filter, binary search as the "index"
    def __init__(self, entries):  # entries: [(key, value or None)] already sorted; None is a tombstone
        self.entries = entries
        self.bloom = Bloom(len(entries))
        for k, _ in entries:
            self.bloom.add(k)

    def find(self, key):
        lo, hi = 0, len(self.entries) - 1
        while lo <= hi:
            mid = (lo + hi) >> 1
            k = self.entries[mid][0]
            if k == key:
                return self.entries[mid]
            if k < key:
                lo = mid + 1
            else:
                hi = mid - 1
        return None


class Lsm:
    def __init__(self, mem_limit, max_runs):
        self.mem_limit, self.max_runs = mem_limit, max_runs
        self.mem, self.runs = {}, []  # runs[0] is the newest
        self.puts = self.flushed = self.compacted = self.bloom_skips = self.run_reads = 0

    def put(self, key, value):
        self.puts += 1  # a real engine appends to the write-ahead log here before touching the memtable
        self.mem[key] = value
        if len(self.mem) >= self.mem_limit:
            self.flush()

    def delete(self, key):
        self.put(key, None)  # a delete is a write of a tombstone

    def flush(self):
        entries = sorted(self.mem.items())
        self.runs.insert(0, Run(entries))
        self.flushed += len(entries)
        self.mem = {}
        if len(self.runs) > self.max_runs:
            self.compact()

    def compact(self):  # merge every run into one; newer entries win, and tombstones can finally be dropped
        merged = {}
        for run in reversed(self.runs):
            for k, v in run.entries:
                merged[k] = v
        entries = sorted((k, v) for k, v in merged.items() if v is not None)
        self.compacted += len(entries)
        self.runs = [Run(entries)] if entries else []

    def get(self, key):
        if key in self.mem:
            return self.mem[key]
        for run in self.runs:  # newest to oldest
            if not run.bloom.might_contain(key):
                self.bloom_skips += 1
                continue
            self.run_reads += 1
            hit = run.find(key)
            if hit:
                return hit[1]  # a tombstone hides every older value
        return None

    def range(self, lo, hi):  # keys in [lo, hi): a scan must merge the memtable and every run
        merged = {}
        for run in reversed(self.runs):
            for k, v in run.entries:
                merged[k] = v
        merged.update(self.mem)
        return [f"{k}={v}" for k, v in sorted(merged.items()) if v is not None and lo <= k < hi]


seed = 7


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 8) % n


def user_key(n):
    return f"user:{n:02d}"


db = Lsm(4, 3)
truth = {}  # a plain dict that must always agree with the LSM
for op in range(1, 41):
    key = user_key(rnd(16))
    if rnd(5) == 0:
        db.delete(key)
        truth.pop(key, None)
    else:
        db.put(key, f"v{op}")
        truth[key] = f"v{op}"
    for n in range(16):
        if db.get(user_key(n)) != truth.get(user_key(n)):
            raise SystemExit(f"stale read of {user_key(n)} after op {op}")
    if op % 10 == 0:
        print(f"op {op}: runs=[{','.join(str(len(r.entries)) for r in db.runs)}] memtable={len(db.mem)}")
db.bloom_skips = db.run_reads = 0
for n in range(20, 36):
    if db.get(user_key(n)) is not None:
        raise SystemExit("ghost key")  # 16 absent keys
print(f"16 lookups of absent keys: {db.run_reads} run reads, {db.bloom_skips} skipped by bloom filters")

amp = (db.flushed + db.compacted) * 100 // db.puts
print(f"writes={db.puts} flushed={db.flushed} compacted={db.compacted} write amplification={amp // 100}.{amp % 100:02d}")
scan = db.range("user:04", "user:10")
print(f"range user:04..user:10 -> {' '.join(scan)}")
expected = [f"{k}={v}" for k, v in sorted(truth.items()) if "user:04" <= k < "user:10"]
if scan != expected:
    raise SystemExit("range disagrees with the reference map")
print("all reads saw the newest value")
