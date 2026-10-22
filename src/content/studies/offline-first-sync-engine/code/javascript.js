// An offline-first sync engine in JavaScript:
// each device keeps a local copy and an outbox, the server merges field by field (newest write wins), and a device that stayed away too long starts again from a snapshot.

// A write is { mid, id, field, v, ts, dev }. The newer write to a field wins; equal timestamps are settled by the device name.
const newer = (a, b) => a.ts > b.ts || (a.ts === b.ts && a.dev > b.dev);
function merge(fields, w) {
  const cur = fields[w.field];
  if (!cur || newer(w, cur)) fields[w.field] = { v: w.v, ts: w.ts, dev: w.dev };
}
const gone = (f) => f._gone !== undefined && f._gone.v === 1; // a delete is just another field: a tombstone

class Server {
  constructor() { this.recs = new Map(); this.seq = 0; this.floor = 0; this.seen = new Set(); this.dups = 0; }
  push(muts) {
    for (const m of muts) {
      if (this.seen.has(m.mid)) { this.dups++; continue; } // a retried mutation is acknowledged but not applied again
      this.seen.add(m.mid);
      const r = this.recs.get(m.id) ?? { f: {}, seq: 0 };
      merge(r.f, m); r.seq = ++this.seq; this.recs.set(m.id, r);
    }
  }
  pull(cursor) {
    const reset = cursor < this.floor; // the tombstones this device needs were already collected
    const recs = [...this.recs].filter(([, r]) => reset || r.seq > cursor).map(([id, r]) => ({ id, f: r.f }));
    return { reset, recs, cursor: this.seq };
  }
  compact(horizon) { // forget tombstones older than the horizon
    let removed = 0;
    for (const [id, r] of [...this.recs]) if (gone(r.f) && r.seq <= horizon) { this.recs.delete(id); removed++; }
    this.floor = horizon; return removed;
  }
}

class Client {
  constructor(dev, skew, server, log) { Object.assign(this, { dev, skew, server, log, db: new Map(), outbox: [], cursor: 0, n: 0, last: 0 }); }
  write(id, field, v, wall) {
    const ts = Math.max(wall + this.skew, this.last + 1); this.last = ts; // never behind anything this device has seen
    const w = { mid: `${this.dev}-${++this.n}`, id, field, v, ts, dev: this.dev };
    merge(this.fields(id), w); this.outbox.push(w); this.log.push(w);
  }
  fields(id) { if (!this.db.has(id)) this.db.set(id, {}); return this.db.get(id); }
  sync(retry) {
    this.server.push(this.outbox);
    if (retry) this.server.push(this.outbox); // the reply was lost, so the client sends the same batch again
    this.outbox = [];
    const res = this.server.pull(this.cursor);
    if (res.reset) this.db = new Map();
    for (const { id, f } of res.recs) for (const [field, c] of Object.entries(f)) { merge(this.fields(id), { field, ...c }); this.last = Math.max(this.last, c.ts); }
    this.cursor = res.cursor; return res.reset;
  }
}

const view = (recs) => [...recs].filter(([, f]) => !gone(f)).sort((a, b) => a[0] - b[0])
  .map(([id, f]) => `${id}:${['title', 'done', 'note'].map((k) => f[k]?.v ?? '-').join('/')}`).join(' ');
const checksum = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1000000007, 7);

const SEED = 99, STEPS = 600, ROWS = 12, DELETE_PCT = 4, MAX_VALUE = 100;
const START_MS = 5000000, STEP_MS = 1000, B_SKEW_MS = -10 * 60 * 1000; // B's clock is 10 minutes slow
const SYNC_EVERY = 7, RETRY_ONE_IN = 4; // a device syncs every 7 steps; 1 sync in 4 also re-sends its last push
const C_SYNC_AT = 100, COMPACT_AT = 400, COMPACT_KEEP = 100; // compaction keeps the last 100 changes
let seed = SEED;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const server = new Server(), log = [];
const [A, B, C] = [new Client('A', 0, server, log), new Client('B', B_SKEW_MS, server, log), new Client('C', 0, server, log)]; // B's clock is 10 minutes slow
let edits = 0, deletes = 0, removed = 0, ghosts = 0, wasReset = false;
for (let step = 0; step < STEPS; step++) {
  const d = rnd(2), c = [A, B][d], id = rnd(ROWS), kind = rnd(100), wall = START_MS + step * STEP_MS;
  if (!(c.db.get(id) && gone(c.db.get(id)))) { // a deleted row is not on screen, so it cannot be edited
    if (kind < DELETE_PCT) { c.write(id, '_gone', 1, wall); deletes++; }
    else { c.write(id, ['title', 'done', 'note'][rnd(3)], rnd(MAX_VALUE), wall); edits++; }
  }
  if (step % SYNC_EVERY === d) c.sync(rnd(RETRY_ONE_IN) === 0);
  if (step === C_SYNC_AT) C.sync(false); // C syncs once and then stays offline
  if (step === COMPACT_AT) removed = server.compact(server.seq - COMPACT_KEEP);
}
const before = new Set([...C.db].filter(([, f]) => !gone(f)).map(([id]) => id));
A.sync(false); B.sync(false); wasReset = C.sync(false); A.sync(false); B.sync(false);
for (const id of before) if (!C.db.has(id) || gone(C.db.get(id))) ghosts++;

const truth = new Map(); // the same writes merged in one pass, to check against
for (const w of log) { if (!truth.has(w.id)) truth.set(w.id, {}); merge(truth.get(w.id), w); }
const views = [A.db, B.db, C.db, new Map([...server.recs].map(([id, r]) => [id, r.f])), truth].map(view);
const agree = views.every((v) => v === views[0]);
console.log(`${edits} edits and ${deletes} deletes on 2 live devices; duplicate pushes ignored: ${server.dups}`);
console.log(`compaction at seq ${server.floor} removed ${removed} tombstones; ${server.recs.size} records remain`);
console.log(`device C was offline from step 100: reset ${wasReset}, deleted rows it still showed: ${ghosts}`);
console.log(`all devices, server and the one-pass merge agree: ${agree}; checksum ${checksum(views[0])}`);
if (!agree || !wasReset || server.dups === 0) process.exit(1);
