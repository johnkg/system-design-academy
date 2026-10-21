// A tiny LSM tree in JavaScript: memtable, immutable sorted runs, bloom filters, tombstones and merge compaction.
// All numbers are integers so the output is identical in every language.
const BITS_PER_KEY = 10; // bloom filter size per key
const HASHES = 4; // hash functions per key (seeds 1..4)
const MEM_LIMIT = 4; // entries the memtable holds before it flushes
const MAX_RUNS = 3; // sorted runs before compaction
const OPS = 40; // demo: random puts and deletes
const KEY_SPACE = 16; // keys user:00..user:15
const DELETE_ONE_IN = 5; // one op in 5 is a delete
const REPORT_EVERY = 10;
const ABSENT_FROM = 20; // keys from here on were never written
const ABSENT_KEYS = 16;

const fnv = (key, seed) => { // deterministic 32-bit FNV-1a hash, seeded
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h;
};

class Bloom {
  constructor(entries) { this.bits = new Array(entries * BITS_PER_KEY).fill(false); } // 10 bits per key, 4 hashes
  slots(key) { return Array.from({ length: HASHES }, (_, i) => i + 1).map((seed) => fnv(key, seed) % this.bits.length); }
  add(key) { for (const s of this.slots(key)) this.bits[s] = true; }
  mightContain(key) { return this.slots(key).every((s) => this.bits[s]); }
}

class Run { // an immutable sorted file (SSTable): sorted keys, a bloom filter, binary search as the "index"
  constructor(entries) { // entries: [[key, value|null]] already sorted; null is a tombstone
    this.entries = entries;
    this.bloom = new Bloom(entries.length);
    for (const [k] of entries) this.bloom.add(k);
  }
  find(key) {
    let lo = 0, hi = this.entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, k = this.entries[mid][0];
      if (k === key) return this.entries[mid];
      if (k < key) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }
}

class Lsm {
  constructor(memLimit, maxRuns) {
    this.memLimit = memLimit; this.maxRuns = maxRuns;
    this.mem = new Map(); this.runs = []; // runs[0] is the newest
    this.puts = 0; this.flushed = 0; this.compacted = 0; this.bloomSkips = 0; this.runReads = 0;
  }
  put(key, value) {
    this.puts++; // a real engine appends to the write-ahead log here before touching the memtable
    this.mem.set(key, value);
    if (this.mem.size >= this.memLimit) this.flush();
  }
  delete(key) { this.put(key, null); } // a delete is a write of a tombstone
  flush() {
    const entries = [...this.mem].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    this.runs.unshift(new Run(entries));
    this.flushed += entries.length;
    this.mem = new Map();
    if (this.runs.length > this.maxRuns) this.compact();
  }
  compact() { // merge every run into one; newer entries win, and tombstones can finally be dropped
    const merged = new Map();
    for (const run of [...this.runs].reverse()) for (const [k, v] of run.entries) merged.set(k, v);
    const entries = [...merged].filter(([, v]) => v !== null).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    this.compacted += entries.length;
    this.runs = entries.length ? [new Run(entries)] : [];
  }
  get(key) {
    if (this.mem.has(key)) return this.mem.get(key) ?? undefined;
    for (const run of this.runs) { // newest to oldest
      if (!run.bloom.mightContain(key)) { this.bloomSkips++; continue; }
      this.runReads++;
      const hit = run.find(key);
      if (hit) return hit[1] ?? undefined; // a tombstone hides every older value
    }
    return undefined;
  }
  range(lo, hi) { // keys in [lo, hi): a scan must merge the memtable and every run
    const merged = new Map();
    for (const run of [...this.runs].reverse()) for (const [k, v] of run.entries) merged.set(k, v);
    for (const [k, v] of this.mem) merged.set(k, v);
    return [...merged].filter(([k, v]) => v !== null && k >= lo && k < hi).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`);
  }
}

let seed = 7;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
const userKey = (n) => `user:${String(n).padStart(2, "0")}`;

const db = new Lsm(MEM_LIMIT, MAX_RUNS);
const truth = new Map(); // a plain map that must always agree with the LSM
for (let op = 1; op <= OPS; op++) {
  const key = userKey(rnd(KEY_SPACE));
  if (rnd(DELETE_ONE_IN) === 0) { db.delete(key); truth.delete(key); }
  else { db.put(key, `v${op}`); truth.set(key, `v${op}`); }
  for (let n = 0; n < KEY_SPACE; n++) {
    if (db.get(userKey(n)) !== truth.get(userKey(n))) throw new Error(`stale read of ${userKey(n)} after op ${op}`);
  }
  if (op % REPORT_EVERY === 0) console.log(`op ${op}: runs=[${db.runs.map((r) => r.entries.length).join(",")}] memtable=${db.mem.size}`);
}
db.bloomSkips = 0; db.runReads = 0;
for (let n = ABSENT_FROM; n < ABSENT_FROM + ABSENT_KEYS; n++) if (db.get(userKey(n)) !== undefined) throw new Error("ghost key"); // 16 absent keys
console.log(`16 lookups of absent keys: ${db.runReads} run reads, ${db.bloomSkips} skipped by bloom filters`);

const amp = Math.floor((db.flushed + db.compacted) * 100 / db.puts);
console.log(`writes=${db.puts} flushed=${db.flushed} compacted=${db.compacted} write amplification=${Math.floor(amp / 100)}.${String(amp % 100).padStart(2, "0")}`);
const scan = db.range("user:04", "user:10");
console.log(`range user:04..user:10 -> ${scan.join(" ")}`);
const expected = [...truth].filter(([k]) => k >= "user:04" && k < "user:10").sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`);
if (scan.join() !== expected.join()) throw new Error("range disagrees with the reference map");
console.log("all reads saw the newest value");
