// Change data capture in miniature, in JavaScript:
// a table that appends every change to a log, a connector that reads the log with committed offsets and crashes once,
// an idempotent sink, and a polling copy for comparison. Values are positive, and 0 means "no row".

const SEED = 7, CHANGES = 400, KEYS = 25, MAX_VALUE = 1000;
const DELETE_IN_10 = 2; // 2 in 10 writes to an existing row delete it
const POLL_EVERY = 50; // changes between two polls
const BATCH = 25, CRASH_AT_BATCH = 6; // the connector crashes once, after its 6th batch

let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const table = new Map(); // key -> { value, updatedAt }
const log = [];          // the source's write-ahead log: one entry per committed change, in order
function write(op, key, value) {
  const before = table.has(key) ? table.get(key).value : 0;
  const lsn = log.length + 1;
  if (op === 'delete') table.delete(key); else table.set(key, { value, updatedAt: lsn });
  log.push({ lsn, op, key, before, after: op === 'delete' ? 0 : value });
}

// Polling by updated_at: it copies rows changed since its cursor, and a deleted row is simply not there to be found.
const polled = new Map();
let cursor = 0;
function poll() {
  for (const [key, row] of table) if (row.updatedAt > cursor) polled.set(key, row.value);
  cursor = log.length;
}

for (let i = 0; i < CHANGES; i++) {
  const key = random(KEYS);
  if (!table.has(key)) write('insert', key, 1 + random(MAX_VALUE));
  else if (random(10) < DELETE_IN_10) write('delete', key, 0);
  else write('update', key, 1 + random(MAX_VALUE));
  if ((i + 1) % POLL_EVERY === 0) poll();
}

// The sink keeps the log position of the last change it applied per key, and ignores anything not newer.
class Sink {
  constructor() { this.rows = new Map(); this.lastLsn = new Map(); this.ignored = 0; }
  apply(e) {
    if (e.lsn <= (this.lastLsn.get(e.key) ?? 0)) { this.ignored++; return; }
    this.lastLsn.set(e.key, e.lsn); // a delete keeps its position too, so a replayed older insert cannot bring the row back
    if (e.op === 'delete') this.rows.delete(e.key); else this.rows.set(e.key, e.after);
  }
}
const sink = new Sink();
let deltaTotal = 0; // a careless sink that adds (after - before) for every event it receives
let delivered = 0, committed = 0, batches = 0, crashed = false;
while (committed < log.length) {
  const batch = log.slice(committed, committed + BATCH);
  for (const e of batch) { sink.apply(e); deltaTotal += e.after - e.before; delivered++; }
  batches++;
  if (batches === CRASH_AT_BATCH && !crashed) { crashed = true; continue; } // crash after applying the batch, before committing its offset: restart from the old offset
  committed += batch.length;
}

const sum = (m, f = (v) => v) => [...m.values()].reduce((a, v) => a + f(v), 0);
const sourceTotal = sum(table, (r) => r.value);
const ghosts = [...polled.keys()].filter((k) => !table.has(k)).length;
const sameRows = table.size === sink.rows.size && [...table].every(([k, r]) => sink.rows.get(k) === r.value);
console.log(`source: ${log.length} changes, ${table.size} rows, total ${sourceTotal}`);
console.log(`polling copy: ${polled.size} rows, ${ghosts} deleted rows still present`);
console.log(`log-based: ${delivered} events delivered for ${log.length} changes, ${delivered - log.length} replayed, ${sink.ignored} ignored by the sink`);
console.log(`idempotent sink matches the source: ${sameRows}, total ${sum(sink.rows)}`);
console.log(`delta-adding sink total: ${deltaTotal}, off by ${deltaTotal - sourceTotal}`);
if (!sameRows || ghosts === 0 || sink.ignored !== delivered - log.length || delivered === log.length || deltaTotal === sourceTotal) process.exit(1);
