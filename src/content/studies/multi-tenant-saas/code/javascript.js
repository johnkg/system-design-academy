// A multi-tenant store in JavaScript: a tenant directory routes each tenant to a shard, one big tenant gets its own shard,
// a query that forgets the tenant filter leaks rows unless row-level security is on, and a fair queue protects small tenants.

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };

const names = ['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark', 'wayne', 'wonka'];
const POOLED = 3, DEDICATED = 3; // shards 0..2 are shared; shard 3 belongs to the big tenant
const dir = new Map();           // the tenant directory: tenant -> shard
for (const t of names) dir.set(t, t === 'acme' ? DEDICATED : hash(t) % POOLED);

let seed = 7;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

let shards = [[], [], [], []];
let nextId = 1;
for (const t of names) {
  const count = t === 'acme' ? 40 : 4 + rnd(5);
  for (let i = 0; i < count; i++) shards[dir.get(t)].push({ id: nextId++, tenant: t, amount: 10 + rnd(990) });
}

// The right query always filters by tenant. The buggy one forgets, and returns the whole shard.
const listSafe = (t) => shards[dir.get(t)].filter((r) => r.tenant === t);
const listBuggy = (t) => shards[dir.get(t)].slice();
// Row-level security: the database applies the policy to every query, whatever the query says.
const withRls = (session, query) => query(session).filter((r) => r.tenant === session);
const leaked = (rows, t) => rows.filter((r) => r.tenant !== t).length;

// One worker does one job per tick. FIFO serves jobs in arrival order; the fair queue takes one job per tenant in turn.
function finish(counts, fair) {
  const done = {}; let tick = 0;
  if (!fair) {
    for (const t of Object.keys(counts)) { tick += counts[t]; done[t] = tick; }
    return done;
  }
  const left = { ...counts };
  while (Object.values(left).some((n) => n > 0)) {
    for (const t of Object.keys(left)) if (left[t] > 0) { tick++; left[t]--; if (left[t] === 0) done[t] = tick; }
  }
  return done;
}

// Moving a tenant: copy its rows, switch the directory entry, delete the old copy.
function moveTenant(t, to) {
  const from = dir.get(t);
  const rows = shards[from].filter((r) => r.tenant === t);
  shards[to].push(...rows);
  shards[from] = shards[from].filter((r) => r.tenant !== t);
  dir.set(t, to);
  return rows.length;
}

console.log(`directory: ${names.map((t) => `${t}->${dir.get(t)}`).join(' ')}`);
console.log(`rows per shard: ${shards.map((s) => s.length).join(' ')}`);
const safeOk = names.every((t) => leaked(listSafe(t), t) === 0);
console.log(`filtered query leaks nothing: ${safeOk}`);
const bugLeak = names.reduce((n, t) => n + leaked(listBuggy(t), t), 0);
const rlsLeak = names.reduce((n, t) => n + leaked(withRls(t, listBuggy), t), 0);
console.log(`missing filter leaks ${bugLeak} rows; with row-level security it leaks ${rlsLeak}`);

const counts = { acme: 30, globex: 3, initech: 3 };
const fifo = finish(counts, false), fair = finish(counts, true);
console.log(`last job done: fifo globex ${fifo.globex} initech ${fifo.initech}; fair globex ${fair.globex} initech ${fair.initech}`);

const before = listSafe('globex').length;
const from = dir.get('globex');
const to = (from + 1) % POOLED;
const moved = moveTenant('globex', to);
console.log(`moved globex from shard ${from} to shard ${to}: ${moved} rows, now ${listSafe('globex').length}`);
if (!safeOk || bugLeak === 0 || rlsLeak !== 0 || fair.globex >= fifo.globex || moved !== before || listSafe('globex').length !== before) process.exit(1);
