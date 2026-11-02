// A miniature of Percolator's transactions from Google's OSDI 2010 paper, in JavaScript (a teaching model, not Google's code):
// every cell has data, lock and write columns indexed by timestamp, a timestamp oracle hands out increasing numbers, a
// transaction reads at its start timestamp, commits with two-phase commit in which one cell's write record is the commit point,
// and a reader that meets a lock left by a crashed transaction rolls it back or forward by looking at the primary lock.
// The example is the paper's: moving $7 from Bob ($10) to Joe ($2). Everything is deterministic.

let oracle = 0;
const nextTs = () => ++oracle;
const rows = {}; // row -> { data: {ts: value}, lock: {ts: 'primary' | 'secondary of <row>'}, write: {ts: data timestamp} }
const cell = (row) => (rows[row] ??= { data: {}, lock: {}, write: {} });

function seed(row, value) { const s = nextTs(), c = nextTs(); cell(row).data[s] = value; cell(row).write[c] = s; }
const fmt = (obj) => `{${Object.keys(obj).sort((a, b) => a - b).map((k) => `${k}:${obj[k]}`).join(' ')}}`;
const show = (label) => { console.log(label); for (const r of Object.keys(rows)) console.log(`  ${r}: data ${fmt(rows[r].data)}  lock ${fmt(rows[r].lock)}  write ${fmt(rows[r].write)}`); };

function latestWrite(row, ts) { // newest commit timestamp at or below ts, and the data timestamp it points to
  const c = Object.keys(cell(row).write).map(Number).filter((k) => k <= ts).sort((a, b) => b - a)[0];
  return c === undefined ? null : { commit: c, dataTs: cell(row).write[c] };
}
function get(row, ts) {
  const locked = Object.keys(cell(row).lock).map(Number).filter((k) => k <= ts);
  if (locked.length) return { blocked: Math.min(...locked) }; // a lock at or below our timestamp: the writer may still commit below it
  const w = latestWrite(row, ts);
  return { value: w ? cell(row).data[w.dataTs] : undefined };
}

function prewrite(row, value, startTs, primary) {
  const c = cell(row);
  if (Object.keys(c.write).some((k) => Number(k) >= startTs)) return 'conflict: a later commit exists';
  if (Object.keys(c.lock).length) return 'conflict: the cell is locked';
  c.data[startTs] = value;
  c.lock[startTs] = row === primary ? 'primary' : `secondary of ${primary}`;
  return 'ok';
}
function commitCell(row, startTs, commitTs) { const c = cell(row); c.write[commitTs] = startTs; delete c.lock[startTs]; }

// A transaction moves money; "crashAfter" stops it at a chosen point.
function transfer(from, to, amount, crashAfter) {
  const startTs = nextTs();
  const a = get(from, startTs).value, b = get(to, startTs).value;
  const results = [prewrite(from, a - amount, startTs, from), prewrite(to, b + amount, startTs, from)];
  if (results.some((r) => r !== 'ok')) {
    for (const r of [from, to]) { delete cell(r).lock[startTs]; delete cell(r).data[startTs]; }
    return { startTs, outcome: `aborted (${results.find((r) => r !== 'ok')})` };
  }
  if (crashAfter === 'prewrite') return { startTs, outcome: 'crashed after the prewrite, locks left behind' };
  const commitTs = nextTs();
  commitCell(from, startTs, commitTs); // the primary's write record is the commit point
  if (crashAfter === 'primary') return { startTs, outcome: 'crashed after committing the primary, the secondary lock is left' };
  commitCell(to, startTs, commitTs);
  return { startTs, commitTs, outcome: `committed at ${commitTs}` };
}

// A reader that meets a lock decides what to do from the primary cell. (Real Percolator does this only when the lock's owner is
// judged dead, after a wait; here the owner has crashed.)
function resolve(row, startTs) {
  const lockTs = Number(Object.keys(cell(row).lock)[0]);
  const kind = cell(row).lock[lockTs];
  const primary = kind === 'primary' ? row : kind.replace('secondary of ', '');
  if (cell(primary).lock[lockTs] !== undefined) { // the primary is still locked: the transaction never committed
    delete cell(primary).lock[lockTs]; delete cell(primary).data[lockTs];
    if (row !== primary) { delete cell(row).lock[lockTs]; delete cell(row).data[lockTs]; }
    return `rolled back the transaction that started at ${lockTs}`;
  }
  const commit = Object.keys(cell(primary).write).map(Number).find((c) => cell(primary).write[c] === lockTs);
  commitCell(row, lockTs, commit); // the primary committed: finish the secondary
  return `rolled forward the transaction that started at ${lockTs}, committed at ${commit}`;
}
const read = (row, ts) => { let r = get(row, ts); if (r.blocked !== undefined) { console.log(`  reading ${row} at ${ts} meets a lock from ${r.blocked}: ${resolve(row, ts)}`); r = get(row, ts); } return r.value; };

seed('Bob', 10); seed('Joe', 2);
show('--- before: Bob has 10 and Joe has 2');
let t = transfer('Bob', 'Joe', 7);
console.log(`transfer of 7: ${t.outcome}`);
show('--- after the commit');
console.log(`a reader with timestamp ${t.startTs} sees Bob ${read('Bob', t.startTs)}, Joe ${read('Joe', t.startTs)}; one with timestamp ${nextTs()} sees Bob ${read('Bob', oracle)}, Joe ${read('Joe', oracle)}`);

console.log('--- two transfers that overlap');
const first = nextTs(); // both read before either commits
const x = prewrite('Bob', 0, first, 'Bob');
const y = prewrite('Bob', 0, first + 1, 'Bob');
console.log(`first prewrite of Bob: ${x}; second prewrite of Bob: ${y}`);
delete cell('Bob').lock[first]; delete cell('Bob').data[first]; delete cell('Bob').data[first + 1];

console.log('--- a transaction crashes after the prewrite');
t = transfer('Bob', 'Joe', 1, 'prewrite');
console.log(`transfer of 1: ${t.outcome}`);
console.log(`  a reader gets: Joe ${read('Joe', nextTs())}`);

console.log('--- a transaction crashes after committing the primary');
t = transfer('Bob', 'Joe', 1, 'primary');
console.log(`transfer of 1: ${t.outcome}`);
console.log(`  a reader gets: Joe ${read('Joe', nextTs())}`);
show('--- final state');
