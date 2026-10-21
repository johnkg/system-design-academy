// A mini database with a write-ahead log: log first, lazy page writes, crash, then analysis / redo / undo.
// Records are {lsn, kind, tx, page, delta, ref}. For a ckpt_end record ref is the LSN where its checkpoint began;
// for a clr (compensation) record ref is the LSN of the update it undoes.

class Db {
  constructor(balances) {
    this.disk = new Map(balances.map((b, p) => [p, [b, 0]])); // page -> [balance, pageLSN]
    this.pool = new Map();   // buffer pool: cached, possibly dirty pages
    this.log = [];           // the log, including a not yet durable tail
    this.flushed = 0;        // log.slice(0, flushed) has been fsynced
    this.fsyncs = 0;
  }
  append(kind, tx, page = -1, delta = 0, ref = 0) {
    const lsn = this.log.length + 1;
    this.log.push({ lsn, kind, tx, page, delta, ref });
    return lsn;
  }
  flush() {
    if (this.log.length > this.flushed) { this.flushed = this.log.length; this.fsyncs++; }
  }
  update(tx, page, delta) {
    const lsn = this.append("update", tx, page, delta);          // 1. describe the change in the log
    if (!this.pool.has(page)) this.pool.set(page, [...this.disk.get(page)]);
    const pg = this.pool.get(page);
    pg[0] += delta;                                              // 2. then change the cached page
    pg[1] = lsn;                                                 // pageLSN = LSN of the last change
  }
  commit(tx) {
    this.append("commit", tx);
    this.flush();                                                // committed = commit record is durable
  }
  evict(page, obeyWal) {                                         // steal: write a page that may be uncommitted
    if (obeyWal) this.flush();                                   // write-ahead rule: log reaches disk first
    this.disk.set(page, this.pool.get(page));
    this.pool.delete(page);
  }
  checkpoint() {
    const begin = this.append("ckpt_begin", 0);
    this.flush();
    for (const page of [...this.pool.keys()].sort((a, b) => a - b)) this.evict(page, true);
    this.append("ckpt_end", 0, -1, 0, begin);
    this.flush();
  }
  crash() {                                                      // power loss: pool and log tail vanish
    const disk = new Map([...this.disk].map(([p, v]) => [p, [...v]]));
    return [disk, this.log.slice(0, this.flushed)];
  }
}

function recover(disk, durable) {
  const log = [...durable];
  let start = 1;
  const state = new Map();
  for (const r of log) if (r.kind === "ckpt_end") start = r.ref; // newest complete checkpoint
  const scanned = log.filter((r) => r.lsn >= start);
  for (const r of scanned) {                                     // analysis: who was still running?
    if (r.kind === "update" || r.kind === "clr") { if (!state.has(r.tx)) state.set(r.tx, "active"); }
    else if (r.kind === "commit") state.set(r.tx, "committed");
  }
  const losers = [...state].filter(([, s]) => s === "active").map(([t]) => t).sort((a, b) => a - b);
  let redone = 0, skipped = 0;
  for (const r of scanned) {                                     // redo: repeat history from the checkpoint
    if (r.kind !== "update" && r.kind !== "clr") continue;
    const pg = disk.get(r.page);
    if (pg[1] < r.lsn) { pg[0] += r.delta; pg[1] = r.lsn; redone++; } // page older than the record? apply it
    else skipped++;
  }
  const done = new Set(log.filter((r) => r.kind === "clr").map((r) => r.ref));
  let undone = 0;
  for (const r of [...log].reverse()) {                          // undo losers, newest change first
    if (r.kind === "update" && losers.includes(r.tx) && !done.has(r.lsn)) {
      const lsn = log[log.length - 1].lsn + 1;
      log.push({ lsn, kind: "clr", tx: r.tx, page: r.page, delta: -r.delta, ref: r.lsn }); // the undo is logged
      const pg = disk.get(r.page);
      pg[0] -= r.delta; pg[1] = lsn;
      undone++;
    }
  }
  return [scanned.length, redone, skipped, losers, undone];
}

const START_BALANCES = [100, 100, 100, 100]; // four pages of $100

function scenario(obeyWal) {
  const db = new Db(START_BALANCES);
  db.update(1, 0, -30); db.update(1, 1, 30); db.commit(1);       // T1: page 0 -> page 1, $30
  db.checkpoint();
  db.update(2, 2, -20); db.update(2, 3, 20); db.commit(2);       // T2 commits, its pages stay in the pool
  db.update(3, 0, -10); db.update(3, 2, 10); db.commit(3);       // T3 commits too
  db.update(4, 1, -50);                                          // T4 debits page 1 ...
  db.evict(1, obeyWal);                                          // ... the pool steals that dirty page ...
  const [disk, log] = db.crash();                                // ... and the power fails before T4 commits
  const onDisk = START_BALANCES.map((_, p) => disk.get(p)[0]).join(",");
  const [scanned, redone, skipped, losers, undone] = recover(disk, log);
  const final = START_BALANCES.map((_, p) => disk.get(p)[0]);
  console.log(`obey write-ahead rule: ${obeyWal ? "true" : "false"}`);
  console.log(`  durable log ${log.length} records, fsyncs ${db.fsyncs}, pages on disk at crash [${onDisk}]`);
  console.log(`  analysis scanned ${scanned}, losers [${losers.join(",")}]; redo applied ${redone} skipped ${skipped}; undo ${undone}`);
  console.log(`  recovered [${final.join(",")}] total ${final.reduce((a, b) => a + b, 0)}`);
  return final;
}

const same = (a, b) => a.join() === b.join();
const good = scenario(true);
if (!same(good, [60, 130, 90, 120])) throw new Error("T1+T2+T3 must survive and T4 must be gone");
const bad = scenario(false);
if (!same(bad, [60, 80, 90, 120])) throw new Error("without the rule T4's debit leaks");
console.log("committed data survived; uncommitted data vanished only with the write-ahead rule");
