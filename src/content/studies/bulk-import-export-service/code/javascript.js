// A bulk import in JavaScript: a resumable chunked upload, row-by-row validation with an error report,
// an idempotent re-run, and a fair scheduler that stops one big tenant from starving small ones.

const SEED = 7;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const CHUNK = 8;
const ROWS = 44, MAX_QTY = 9;
const ROW_KINDS = 10; // 1 in 10 rows has a bad email, 1 in 10 a bad quantity
const makeRows = (n) => Array.from({ length: n }, (_, k) => {
  const i = k + 1, r = rand(ROW_KINDS);
  return r === 0 ? `${i},bad-email,3` : r === 1 ? `${i},u${i}@x.io,many` : `${i},u${i}@x.io,${1 + rand(MAX_QTY)}`;
});

// The server remembers which chunks arrived, so a client that reconnects only sends the missing ones.
class Upload {
  constructor(total) { this.total = total; this.chunks = new Map(); this.dupes = 0; }
  put(i, rows) { if (this.chunks.has(i)) this.dupes++; else this.chunks.set(i, rows); } // a repeated chunk is ignored
  missing() { return Array.from({ length: this.total }, (_, i) => i).filter((i) => !this.chunks.has(i)); }
}

// Streaming validation: one row at a time, never holding the whole file, and every problem gets its line number.
function validate(upload, onValid, errors) {
  for (let i = 0; i < upload.total; i++) {
    upload.chunks.get(i).forEach((line, j) => {
      const [id, email, qty] = line.split(',');
      const at = `line ${i * CHUNK + j + 1}`;
      if (!/^\d+$/.test(id)) errors.push(`${at}: id`);
      else if (!email.includes('@')) errors.push(`${at}: email`);
      else if (!/^[1-9]$/.test(qty)) errors.push(`${at}: qty`);
      else onValid({ id: Number(id), email, qty: Number(qty) });
    });
  }
}

// An upsert by natural key: applying the same row again changes nothing, so a re-run is safe.
function apply(store, rec) {
  const cur = store.get(rec.id);
  if (cur && cur.email === rec.email && cur.qty === rec.qty) return false;
  store.set(rec.id, rec);
  return true;
}

// The job key is a hash of the content, so submitting the same file twice returns the same job.
const fnv = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const jobs = new Map();
const submit = (rows) => { const key = fnv(rows.join('\n')); if (!jobs.has(key)) jobs.set(key, `job-${jobs.size + 1}`); return jobs.get(key); };

// Fair: one chunk per tenant per round. FIFO: the first tenant's queue is drained before the next.
function schedule(queues, fair) {
  const left = { ...queues }, done = {}, names = Object.keys(left);
  let tick = 0;
  const take = (n) => { left[n]--; tick++; if (left[n] === 0) done[n] = tick; };
  while (names.some((n) => left[n] > 0)) {
    if (fair) names.filter((n) => left[n] > 0).forEach(take);
    else take(names.find((n) => left[n] > 0));
  }
  return names.map((n) => `${n}=${done[n]}`).join(' ');
}

const rows = makeRows(ROWS);
const up = new Upload(Math.ceil(rows.length / CHUNK));
const chunk = (i) => rows.slice(i * CHUNK, (i + 1) * CHUNK);
[0, 1, 2, 1].forEach((i) => up.put(i, chunk(i))); // the connection drops here, and chunk 1 was sent twice
const gaps = up.missing();
console.log(`after the drop the server is missing chunks ${gaps.join(',')} and ignored ${up.dupes} repeat`);
gaps.forEach((i) => up.put(i, chunk(i)));

const store = new Map(), errors = [];
let written = 0;
validate(up, (rec) => { if (apply(store, rec)) written++; }, errors);
console.log(`${submit(rows)}: ${rows.length} rows, ${written} written, ${errors.length} rejected`);
console.log(`first errors: ${errors.slice(0, 3).join('; ')}`);

let again = 0;
validate(up, (rec) => { if (apply(store, rec)) again++; }, []);
console.log(`re-run: ${again} writes, same job: ${submit(rows) === 'job-1'}`);

const queues = { A: 30, B: 4, C: 4 };
console.log(`finish tick, FIFO: ${schedule(queues, false)}`);
console.log(`finish tick, fair: ${schedule(queues, true)}`);
if (written + errors.length !== rows.length || again !== 0 || store.size !== written) process.exit(1);
