// A live migration in JavaScript: snapshot, then a change log replayed on the new database, chunk checksums, a cutover, and a way back.
// The "databases" are maps from row id to value, so the idea fits on one screen.

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

class Db {
  constructor() { this.rows = new Map(); this.log = []; this.nextId = 1; } // log = the change stream (a Postgres WAL, a MySQL binlog)
  set(id, val) { this.rows.set(id, val); this.log.push({ op: 'set', id, val }); }
  del(id) { this.rows.delete(id); this.log.push({ op: 'del', id }); }
  apply(e) { this.nextId = Math.max(this.nextId, e.id + 1); if (e.op === 'set') this.rows.set(e.id, e.val); else this.rows.delete(e.id); } // idempotent: replaying an entry changes nothing; the id counter follows the highest id seen
}

function workload(db, n) { // updates, inserts and deletes, as the application keeps running
  for (let i = 0; i < n; i++) {
    const r = random(10);
    if (r < 6) { const id = 1 + random(db.nextId - 1); db.set(id, random(1000)); }
    else if (r < 8) { const id = db.nextId++; db.set(id, random(1000)); }
    else db.del(1 + random(db.nextId - 1));
  }
}

const diverged = (a, b) => { let n = 0; for (let id = 1; id < Math.max(a.nextId, b.nextId); id++) if ((a.rows.get(id) ?? -1) !== (b.rows.get(id) ?? -1)) n++; return n; };

function chunkSums(db, size) { // one checksum per range of ids, cheap to compare even for billions of rows
  const sums = [];
  for (let id = 1; id < db.nextId; id++) {
    const c = Math.floor((id - 1) / size);
    if (sums[c] === undefined) sums[c] = 0;
    if (db.rows.has(id)) sums[c] = (Math.imul(sums[c], 31) + id * 1000 + db.rows.get(id)) >>> 0;
  }
  return sums;
}
const badChunks = (a, b) => { const x = chunkSums(a, 100), y = chunkSums(b, 100); return x.filter((s, i) => s !== y[i]).length; };

function build() { seed = 7; const db = new Db(); for (let i = 0; i < 1000; i++) db.set(db.nextId++, random(1000)); db.log = []; return db; }

// 1. Copying rows while the application writes, with no snapshot and no change log.
{
  const src = build(), dst = new Db(); const end = src.nextId;
  for (let t = 0; t < 10; t++) { for (let id = 1 + t * 100; id < Math.min(end, 101 + t * 100); id++) if (src.rows.has(id)) dst.rows.set(id, src.rows.get(id)); workload(src, 50); }
  dst.nextId = src.nextId;
  var naive = diverged(src, dst);
}
console.log(`live copy with no change log: ${naive} rows diverged`);
if (naive === 0) process.exit(1);

// 2. Snapshot, bulk copy, then replay the change log, 80 entries per tick, until the lag is below 30.
function migrate(reverse) {
  const src = build(); const snap = new Map(src.rows), snapNext = src.nextId; const dst = new Db();
  for (let t = 0; t < 10; t++) { for (let id = 1 + t * 100; id < 101 + t * 100; id++) if (snap.has(id)) dst.rows.set(id, snap.get(id)); workload(src, 50); }
  let applied = 0, ticks = 0; const start = src.log.length;
  while (src.log.length - applied >= 30) { workload(src, 50); for (let k = 0; k < 80 && applied < src.log.length; k++) dst.apply(src.log[applied++]); ticks++; }
  const lag = src.log.length - applied, before = badChunks(src, dst); // freeze writes here
  while (applied < src.log.length) dst.apply(src.log[applied++]);
  console.log(`snapshot + log: ${start} entries behind after the bulk copy, caught up in ${ticks} ticks, lag at the freeze ${lag}`);
  console.log(`checksums: ${before} chunks differ at the freeze, ${badChunks(src, dst)} after the last entries; rows diverged ${diverged(src, dst)}`);
  if (diverged(src, dst) !== 0 || badChunks(src, dst) !== 0) process.exit(1);
  let clash = 0; for (let k = 0; k < 50; k++) if (src.rows.has(snapNext + k)) clash++;
  dst.nextId = src.nextId + 1000; // leave a gap, so new ids never meet ids the old database handed out
  console.log(`ids: restarting at ${snapNext} collides with ${clash} live rows; restarting at ${dst.nextId} collides with 0`);
  if (clash === 0) process.exit(1);
  dst.log = []; workload(dst, 200); // the flip happened; the new database takes 200 writes
  if (reverse) for (const e of dst.log) src.apply(e); // reverse replication keeps the old database current
  const lost = reverse ? 0 : dst.log.length;
  console.log(`rollback ${reverse ? 'with' : 'without'} reverse replication: ${lost} writes lost, rows diverged ${diverged(src, dst)}`);
  return { lost, off: diverged(src, dst) };
}
const a = migrate(true), b = migrate(false);
if (a.lost !== 0 || a.off !== 0 || b.lost === 0 || b.off === 0) process.exit(1);
