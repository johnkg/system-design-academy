// Keyed counters with checkpoints: state + input offset are snapshotted together, a crash restores both and replays.
const N = 600, KEYS = 12, OPS = 3, CRASH = 330, COMMIT_EVERY = 120;

// Seeded orders stream: event i is "customer k placed an order"; low ids are the busy customers.
const EVENTS = [];
let x = 12345;
for (let i = 0; i < N; i++) {
  x = (x * 48271) % 2147483647;
  const r = x % 1000;
  EVENTS.push(Math.floor((r * r * KEYS) / 1000000));
}
// key -> key group -> operator instance: each key lives on exactly one instance.
const opOf = (k) => Math.floor((((k * 7 + 2) % 12) * OPS) / 12);

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
for (const i of [0, 50, 200]) must(run(i, "plain", false).wrong === 0, "state exact with checkpoints");
const idem = run(50, "idempotent", false);
const tx = run(50, "transactional", false);
run(200, "transactional", false);
const plain = run(50, "plain", false);
must(plain.dup === 30 && plain.replayed === 30, "plain sink repeats the replayed outputs");
must(idem.dup === 0 && idem.extra === 30 && idem.wrong === 0, "upsert absorbs the replay");
must(tx.dup === 0 && tx.missing === 0 && tx.extra === 30, "2PC sink: no duplicates, open transaction aborted");
const behind = run(50, "plain", true), ahead = run(200, "plain", true);
must(behind.double === 60 && behind.wrong > 0, "offset committed separately, behind the state: double counting");
must(ahead.lost === 40 && ahead.wrong > 0, "offset committed separately, ahead of the state: lost events");
console.log("ok");
