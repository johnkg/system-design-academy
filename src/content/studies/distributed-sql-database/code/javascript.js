// A tiny distributed SQL core, in JavaScript: keys split into ranges, versions stamped by a hybrid logical clock,
// and a transaction that commits across ranges with write intents and a transaction record (two-phase commit).

class Hlc { // wall time plus a counter, so timestamps never go backwards and follow causality
  constructor(offset) { this.offset = offset; this.wall = 0; this.logical = 0; } // offset: how far this machine's clock is off
  now(real) {
    const w = real + this.offset;
    if (w > this.wall) { this.wall = w; this.logical = 0; } else this.logical++;
    return this.wall * 100 + this.logical;
  }
  observe(ts) { const w = Math.floor(ts / 100); if (w > this.wall) { this.wall = w; this.logical = ts % 100; } } // a message carries a timestamp
}

class Range {
  constructor(lo, hi) { this.lo = lo; this.hi = hi; this.cells = new Map(); } // key -> { versions: [[ts, value]], intent }
  cell(key) { if (!this.cells.has(key)) this.cells.set(key, { versions: [], intent: null }); return this.cells.get(key); }
}

class Db {
  constructor(maxKeys) { this.ranges = [new Range('', '~')]; this.records = new Map(); this.seq = 0; this.maxKeys = maxKeys; }
  rangeIndex(key) { return this.ranges.findIndex((r) => key >= r.lo && key < r.hi); }
  split() { // a range with too many keys is cut at its middle key
    for (let i = 0; i < this.ranges.length; i++) {
      const r = this.ranges[i], keys = [...r.cells.keys()].sort();
      if (keys.length <= this.maxKeys) continue;
      const mid = keys[keys.length >> 1], right = new Range(mid, r.hi);
      for (const k of keys) if (k >= mid) { right.cells.set(k, r.cells.get(k)); r.cells.delete(k); }
      r.hi = mid; this.ranges.splice(i + 1, 0, right); i--;
    }
  }
  // Reads a key as of ts. A value stamped inside (ts, ts + maxOffset] might have committed before this read began, so the read restarts above it.
  read(key, ts, maxOffset) {
    for (let restarts = 0; ; restarts++) {
      const c = this.ranges[this.rangeIndex(key)].cell(key), rec = c.intent && this.records.get(c.intent.txn);
      if (rec && rec.status === 'PENDING') return { blocked: true };
      const all = c.versions.concat(rec ? [[rec.ts, c.intent.value]] : []); // a committed intent counts as a version
      const seen = all.filter(([t]) => t <= ts), later = all.filter(([t]) => t > ts && t <= ts + maxOffset * 100);
      if (later.length === 0) return { value: seen.length ? seen[seen.length - 1][1] : null, restarts };
      ts = later[later.length - 1][0]; maxOffset = 0; // restart at the newest uncertain version
    }
  }
}

class Txn {
  constructor(db, clock, real) { this.db = db; this.id = ++db.seq; this.ts = clock.now(real); this.keys = []; db.records.set(this.id, { status: 'PENDING', ts: this.ts }); }
  write(key, value) { // phase 1: leave an intent on the key. Another transaction's intent blocks us
    const c = this.db.ranges[this.db.rangeIndex(key)].cell(key);
    if (c.intent) return false;
    const last = c.versions[c.versions.length - 1];
    if (last && last[0] >= this.ts) this.ts = last[0] + 1; // never write under a newer version
    c.intent = { txn: this.id, value }; this.keys.push(key); return true;
  }
  commit() { const rec = this.db.records.get(this.id); rec.status = 'COMMITTED'; rec.ts = this.ts; } // the single atomic commit point
  resolve() { // phase 2, in the background: turn the intents into ordinary versions
    for (const k of this.keys) { const c = this.db.ranges[this.db.rangeIndex(k)].cell(k); c.versions.push([this.ts, c.intent.value]); c.intent = null; }
  }
}

const db = new Db(3), a = new Hlc(0), b = new Hlc(-8);
[['alice', 100], ['bob', 50], ['carol', 70], ['maria', 100], ['nina', 20], ['zed', 100]].forEach(([k, v], i) => {
  const t = new Txn(db, a, 1 + i); t.write(k, v); t.commit(); t.resolve(); db.split();
});
console.log(`ranges after splits: ${db.ranges.map((r) => `[${r.lo}..${r.hi})`).join(' ')}`);
const total = () => ['alice', 'bob', 'carol', 'maria', 'nina', 'zed'].reduce((s, k) => s + db.read(k, 999999, 0).value, 0);
const before = total(), setupTs = 6 * 100;

const t1 = new Txn(db, a, 20); // move 30 from alice to zed: two keys in two ranges
t1.write('alice', 70); t1.write('zed', 130);
const ranges = new Set(t1.keys.map((k) => db.rangeIndex(k)));
console.log(`T1 touched ${ranges.size} ranges, commit timestamp ${t1.ts}`);
const t2 = new Txn(db, a, 21);
console.log(`T2 write to zed blocked by T1's intent: ${!t2.write('zed', 1)}`);
console.log(`reader before T1 commits is blocked: ${db.read('zed', 3000, 0).blocked}`);
t1.commit();
console.log(`reader after the commit point sees zed = ${db.read('zed', 3000, 0).value}, even before intents are resolved`);
t1.resolve();
console.log(`snapshot at ts ${setupTs} still sees alice = ${db.read('alice', setupTs, 0).value}, zed = ${db.read('zed', setupTs, 0).value}`);

const ts = b.now(22); // this gateway's clock runs 8 behind, so its read timestamp is below T1's commit timestamp
const trusting = db.read('zed', ts, 0), careful = db.read('zed', ts, 10);
console.log(`behind clock, read at ${ts}: trusting clocks sees ${trusting.value}; with a 10 uncertainty window sees ${careful.value} after ${careful.restarts} restart`);
b.observe(t1.ts);
console.log(`after a message from T1's gateway, the next timestamp here is ${b.now(23)}`);
const after = total();
console.log(`total money before ${before}, after ${after}`);
if (before !== after || ranges.size !== 2 || trusting.value !== 100 || careful.value !== 130 || careful.restarts !== 1 || b.now(24) <= t1.ts || db.ranges.length !== 3) process.exit(1);
