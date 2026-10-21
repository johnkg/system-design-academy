// G-Counter, PN-Counter and OR-Set as state-based CRDTs, plus a naive last-write-wins counter for contrast.
// merge() is commutative, associative and idempotent, so any delivery order, with duplicates, converges.
const IDS = "ABC";
const INITIAL_SPLIT = [4, 3, 3]; // the starting stock, already spread over replicas A, B, C
const INITIAL_COUNT = 10; // sum of INITIAL_SPLIT
const TS_STEP = 100; // ms between scripted operations (the LWW timestamp)
const maxv = (a, b) => a.map((x, i) => Math.max(x, b[i]));
const sum = (a) => a.reduce((x, y) => x + y, 0);

class LWWCounter { // naive: one number and a timestamp, newest write wins
  constructor(v = INITIAL_COUNT, ts = 0, by = 0) { this.v = v; this.ts = ts; this.by = by; }
  inc(r, ts) { this.v += 1; this.ts = ts; this.by = r; }
  dec(r, ts) { this.v -= 1; this.ts = ts; this.by = r; }
  merge(o) {
    const w = (o.ts > this.ts || (o.ts === this.ts && o.by > this.by)) ? o : this;
    return new LWWCounter(w.v, w.ts, w.by);
  }
  value() { return String(this.v); }
  key() { return `${this.v}@${this.ts}`; }
  size() { return 2; }
}

class GCounter { // one slot per replica, merge = element-wise max
  constructor(p = INITIAL_SPLIT) { this.p = [...p]; }
  inc(r) { this.p[r] += 1; }
  merge(o) { return new GCounter(maxv(this.p, o.p)); }
  value() { return String(sum(this.p)); }
  key() { return "[" + this.p.join(",") + "]"; }
  size() { return this.p.length; }
}

class PNCounter { // two G-Counters: increments and decrements
  constructor(p = INITIAL_SPLIT, n = [0, 0, 0]) { this.p = [...p]; this.n = [...n]; }
  inc(r) { this.p[r] += 1; }
  dec(r) { this.n[r] += 1; }
  merge(o) { return new PNCounter(maxv(this.p, o.p), maxv(this.n, o.n)); }
  value() { return String(sum(this.p) - sum(this.n)); }
  key() { return "P[" + this.p.join(",") + "]N[" + this.n.join(",") + "]"; }
  size() { return this.p.length + this.n.length; }
}

class ORSet { // adds carry unique tags; remove tombstones only the tags it has observed
  constructor(adds = { A0: "urgent" }, rem = [], seq = 0) { this.adds = { ...adds }; this.rem = new Set(rem); this.seq = seq; }
  add(r, el) { this.adds[IDS[r] + this.seq] = el; this.seq += 1; }
  remove(r, el) { for (const [t, e] of Object.entries(this.adds)) if (e === el) this.rem.add(t); }
  merge(o) { return new ORSet({ ...this.adds, ...o.adds }, [...this.rem, ...o.rem], this.seq); }
  value() { return [...new Set(Object.entries(this.adds).filter(([t]) => !this.rem.has(t)).map(([, e]) => e))].sort().join(","); }
  key() { return Object.entries(this.adds).map(([t, e]) => `${t}=${e}`).sort().join(";") + "|" + [...this.rem].sort().join(","); }
  size() { return Object.keys(this.adds).length + this.rem.size; }
}

function counters(Cls, withDec) {
  const reps = [new Cls(), new Cls(), new Cls()];
  const script = [[0, 1], [1, 1], [2, 1], [0, 1], [1, 1], [2, 1], [0, 1], [1, 1], [1, 1], [1, 1], [2, 1], [2, -1]];
  let net = INITIAL_COUNT;
  script.forEach(([r, d], i) => {
    if (d > 0) { reps[r].inc(r, (i + 1) * TS_STEP); net += 1; }
    else if (withDec) { reps[r].dec(r, (i + 1) * TS_STEP); net -= 1; }
  });
  return [reps, net];
}

function sets(Cls) {
  const reps = [new Cls(), new Cls(), new Cls()];
  reps[0].remove(0, "urgent"); // A removes the tag it has seen...
  reps[1].add(1, "urgent");    // ...while B concurrently adds it again, under a new unique tag
  reps[2].add(2, "billing");
  return [reps, null];
}

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}

function converge(name, Cls, build, withDec = true) {
  const keys = new Set(), values = new Set(), sizes = new Set();
  let expected = null;
  for (const perm of permutations([0, 1, 2])) { // 6 merge orders
    let reps;
    [reps, expected] = build(Cls, withDec);
    const snaps = reps.map((r) => r.merge(r)); // copies, replayed later as stale messages
    for (let round = 0; round < 2; round++) // every pull is delivered twice
      for (const i of perm) for (const j of perm) if (i !== j) reps[i] = reps[i].merge(reps[j]);
    const before = reps.map((r) => r.key());
    for (let i = 0; i < IDS.length; i++) for (const s of snaps) reps[i] = reps[i].merge(s);
    if (before.join("#") !== reps.map((r) => r.key()).join("#")) throw new Error("stale replay changed a state");
    if (new Set(reps.map((r) => r.key())).size !== 1) throw new Error("replicas diverged");
    keys.add(reps[0].key()); values.add(reps[0].value()); sizes.add(reps[0].size());
  }
  if (keys.size !== 1) throw new Error("order changed the result");
  const value = [...values][0];
  console.log(`${name}: 6 orders x duplicates -> ${value} state=${[...keys][0]} size=${[...sizes][0]} expected=${expected === null ? "-" : expected}`);
  return [value, expected];
}

function check(ok, msg) { if (!ok) throw new Error(msg); }

let [v, e] = converge("G-Counter ", GCounter, counters, false);
check(Number(v) === 21 && e === 21, "G-Counter");
[v, e] = converge("PN-Counter", PNCounter, counters);
check(Number(v) === 20 && e === 20, "PN-Counter");
[v, e] = converge("LWW counter", LWWCounter, counters);
console.log(`  naive LWW shows ${v} instead of ${e}: ${e - Number(v)} increments lost`);
check(Number(v) === 12 && e - Number(v) === 8, "LWW should lose increments");
[v] = converge("OR-Set    ", ORSet, sets);
check(v === "billing,urgent", "add wins"); // B's concurrent add survives A's remove

const s = new ORSet({ A0: "urgent" }, [], 1); // A already used tag A0 for the first 'urgent'
for (let i = 0; i < 5; i++) { s.add(0, "vip"); s.remove(0, "vip"); }
console.log(`OR-Set after 5 add/remove cycles: value='${s.value()}' size=${s.size()} (tombstones grow until garbage collected)`);
check(s.value() === "urgent" && s.size() === 11, "tombstone growth");
