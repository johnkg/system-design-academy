// A tiny lakehouse table in JavaScript: immutable data files, a snapshot per commit,
// optimistic commits that rebase or abort, compaction, time travel and vacuum.

class Table {
  constructor() { this.snaps = [[]]; this.store = new Map(); this.seq = 0; this.oldest = 0; } // a snapshot is a list of [file, rows]
  get head() { return this.snaps.length - 1; }
  newFile(rows) { const name = `f${++this.seq}`; this.store.set(name, rows); return [name, rows]; } // uploaded before it is committed
  begin() { return { base: this.head, add: [], remove: [] }; }

  // Commit succeeds only if nobody committed since tx.base. Otherwise rebase on the new head,
  // unless a file this transaction wants to remove is already gone: that is a real conflict.
  commit(tx) {
    let rebases = 0;
    for (;;) {
      if (tx.base === this.head) {
        const kept = this.snaps[this.head].filter(([n]) => !tx.remove.includes(n));
        this.snaps.push([...kept, ...tx.add]);
        return { ok: true, rebases };
      }
      const now = this.snaps[this.head];
      if (tx.remove.some((n) => !now.some(([m]) => m === n))) return { ok: false, rebases };
      tx.base = this.head; rebases++;
    }
  }

  total(v) {
    if (v < this.oldest) throw new Error(`snapshot ${v} expired`);
    return this.snaps[v].reduce((s, [, r]) => s + r, 0);
  }

  vacuum(keep) { // forget old snapshots, then delete files that no kept snapshot uses
    this.oldest = this.head - keep + 1;
    const live = new Set(this.snaps.slice(this.oldest).flat().map(([n]) => n));
    for (const n of [...this.store.keys()]) if (!live.has(n)) this.store.delete(n);
  }
}

const SEED = 7, ROUNDS = 12, WRITERS = 3, MIN_ROWS = 10, ROW_SPREAD = 40;
const SMALL_FILE_ROWS = 30; // compaction merges files smaller than this
const APPEND_ROWS = 25, DELETED_ROWS = 5, KEEP_SNAPSHOTS = 3, OLD_VERSION = 3;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), top 24 bits.
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };

const t = new Table();
const history = [0]; // history[v] = rows at version v, written down at commit time
let expected = 0, rebases = 0;
const done = (tx) => { const r = t.commit(tx); if (!r.ok) throw new Error('unexpected conflict'); rebases += r.rebases; history.push(t.total(t.head)); };

for (let round = 0; round < ROUNDS; round++) { // three writers start from the same snapshot every round
  const txs = Array.from({ length: WRITERS }, () => { const tx = t.begin(); tx.rows = MIN_ROWS + rnd(ROW_SPREAD); tx.add.push(t.newFile(tx.rows)); return tx; });
  for (const tx of txs) { done(tx); expected += tx.rows; }
}
console.log(`appends: version ${t.head}, ${t.snaps[t.head].length} files, ${t.total(t.head)} rows, ${rebases} rebases`);

const plan = () => { // merge every small file into one
  const tx = t.begin(); const small = t.snaps[tx.base].filter(([, r]) => r < SMALL_FILE_ROWS);
  tx.remove = small.map(([n]) => n); tx.add.push(t.newFile(small.reduce((s, [, r]) => s + r, 0)));
  return tx;
};
let compaction = plan();
const append = t.begin(); append.add.push(t.newFile(APPEND_ROWS));
const del = t.begin(); const victim = compaction.remove[0]; del.remove = [victim]; del.add.push(t.newFile(t.store.get(victim) - DELETED_ROWS));
done(append); expected += APPEND_ROWS;
done(del); expected -= DELETED_ROWS;
let conflicts = 0;
while (!t.commit(compaction).ok) { conflicts++; compaction = plan(); } // replan from the new head
history.push(t.total(t.head));
console.log(`compaction: ${conflicts} conflict, version ${t.head}, ${t.snaps[t.head].length} files, ${t.total(t.head)} rows`);

const before = t.store.size;
t.vacuum(KEEP_SNAPSHOTS);
console.log(`vacuum: ${before} stored files -> ${t.store.size}`);
let expired = false;
try { t.total(OLD_VERSION); } catch { expired = true; }
const travel = [t.head - 2, t.head - 1, t.head].every((v) => t.total(v) === history[v]);
console.log(`time travel matches history: ${travel}; version 3 expired: ${expired}`);
if (t.total(t.head) !== expected || !travel || !expired || conflicts !== 1) process.exit(1);
