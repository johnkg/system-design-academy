// Keyed counters with checkpoints: state + input offset are snapshotted together, a crash restores both and replays.
const N = 600, KEYS = 12, OPS = 3, CRASH = 330, COMMIT_EVERY = 120;
const SEED = 12345, SKEW_STEPS = 1000; // r in 0..999 is squared, so low keys are hot
const KEY_GROUPS = 12;
const SHORT_INTERVAL = 50, LONG_INTERVAL = 200; // checkpoint intervals, in events

// Seeded orders stream: event i is "customer k placed an order"; low ids are the busy customers.
const EVENTS = [];
let x = SEED;
for (let i = 0; i < N; i++) {
  // Park-Miller "minimal standard" LCG (MINSTD).
  x = (x * 48271) % 2147483647;
  const r = x % SKEW_STEPS;
  EVENTS.push(Math.floor((r * r * KEYS) / (SKEW_STEPS * SKEW_STEPS)));
}
// key -> key group -> operator instance: each key lives on exactly one instance.
const opOf = (k) => Math.floor((((k * 7 + 2) % KEY_GROUPS) * OPS) / KEY_GROUPS);

class Sink {
  constructor(kind) { this.kind = kind; this.records = []; this.pending = []; this.table = new Array(KEYS).fill(0); this.writes = 0; }
  emit(off, k, count) {
    if (this.kind === "plain") this.records.push(off);
    else if (this.kind === "idempotent") { this.table[k] = count; this.writes++; } // keyed upsert
    else this.pending.push(off); // transactional: held in an open transaction
  }
  commit() { this.records.push(...this.pending); this.pending = []; } // checkpoint completed
  abort() { const n = this.pending.length; this.pending = []; return n; }
}

function run(interval, kind, separate) {
  const sink = new Sink(kind);
  const zero = () => Array.from({ length: OPS }, () => new Array(KEYS).fill(0));
  const copy = (s) => s.map((a) => a.slice());
  let ops = zero();
  let snap = { ops: zero(), offset: 0 };
  const process = (off) => {
    const k = EVENTS[off], o = opOf(k);
    ops[o][k]++;
    sink.emit(off, k, ops[o][k]);
  };
  for (let off = 0; off < CRASH; off++) {
    process(off);
    if (interval > 0 && (off + 1) % interval === 0) { snap = { ops: copy(ops), offset: off + 1 }; sink.commit(); }
  }
  const aborted = sink.abort(); // crash: the open transaction is rolled back, memory is gone
  const restore = separate ? Math.floor(CRASH / COMMIT_EVERY) * COMMIT_EVERY : snap.offset;
  ops = copy(snap.ops);
  for (let off = restore; off < CRASH; off++) process(off);
  sink.commit();
  const truth = new Array(KEYS).fill(0);
  for (let i = 0; i < CRASH; i++) truth[EVENTS[i]]++;
  let wrong = 0;
  for (let k = 0; k < KEYS; k++) if (ops[opOf(k)][k] !== truth[k]) wrong++;
  let rows, dup = 0, missing = 0, extra = 0;
  if (kind === "idempotent") { rows = sink.table.filter((c) => c > 0).length; extra = sink.writes - CRASH; }
  else {
    rows = sink.records.length;
    dup = rows - new Set(sink.records).size;
    missing = CRASH - new Set(sink.records).size;
    extra = aborted;
  }
  const r = { restore, replayed: CRASH - restore, lost: Math.max(0, restore - snap.offset), double: Math.max(0, snap.offset - restore), wrong, rows, dup, missing, extra };
  console.log(`i=${interval} ${kind} separate=${separate} restore=${r.restore} replayed=${r.replayed} lost=${r.lost} double=${r.double} wrong_keys=${r.wrong} rows=${r.rows} dup=${r.dup} missing=${r.missing} extra=${r.extra}`);
  return r;
}

const must = (c, m) => { if (!c) { console.log("FAILED: " + m); process.exit(1); } };
for (const i of [0, SHORT_INTERVAL, LONG_INTERVAL]) must(run(i, "plain", false).wrong === 0, "state exact with checkpoints");
const idem = run(SHORT_INTERVAL, "idempotent", false);
const tx = run(SHORT_INTERVAL, "transactional", false);
run(LONG_INTERVAL, "transactional", false);
const plain = run(SHORT_INTERVAL, "plain", false);
must(plain.dup === 30 && plain.replayed === 30, "plain sink repeats the replayed outputs");
must(idem.dup === 0 && idem.extra === 30 && idem.wrong === 0, "upsert absorbs the replay");
must(tx.dup === 0 && tx.missing === 0 && tx.extra === 30, "2PC sink: no duplicates, open transaction aborted");
const behind = run(SHORT_INTERVAL, "plain", true), ahead = run(LONG_INTERVAL, "plain", true);
must(behind.double === 60 && behind.wrong > 0, "offset committed separately, behind the state: double counting");
must(ahead.lost === 40 && ahead.wrong > 0, "offset committed separately, ahead of the state: lost events");
console.log("ok");
