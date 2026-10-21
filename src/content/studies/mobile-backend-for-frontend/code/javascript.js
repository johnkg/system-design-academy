// A mobile backend-for-frontend (BFF) in JavaScript:
// one home-screen request fans out to five services in parallel, each with its own timeout,
// optional parts may be missing (a partial response), the body is shaped to what the app version needs, and an ETag lets the app skip an unchanged body.

// since: the first app version that shows this part. required: without it there is no screen. timeout in ms.
const services = [
  { name: 'profile', required: true, since: 1, timeout: 120, base: 30, spread: 40 },
  { name: 'orders', required: true, since: 1, timeout: 150, base: 40, spread: 60 },
  { name: 'recs', required: false, since: 1, timeout: 100, base: 40, spread: 120 },
  { name: 'promos', required: false, since: 3, timeout: 80, base: 20, spread: 100 },
  { name: 'inbox', required: false, since: 1, timeout: 80, base: 15, spread: 30 },
];
const RAW_EXTRA = 300; // bytes each service returns that this screen never shows
const SHOWN_BYTES = 12; // bytes of each service's reply that the screen does show
const HANG_PERCENT = 3, HANG_MS = 2000;
const USERS = 20, NEW_VERSION = 3, OLD_VERSION = 2, P95_BUDGET_MS = 150;

const SEED = 7;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const latency = (s) => { const l = s.base + rnd(s.spread); return rnd(100) < HANG_PERCENT ? HANG_MS : l; }; // 3% of calls hang

// FNV-1a, 32 bits: a cheap stand-in for the hash behind an ETag.
function etagOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function handle(user, version) {
  const plan = services.filter((s) => s.since <= version);       // an old app never triggers a call it cannot show
  const calls = plan.map((s) => ({ s, ms: latency(s) }));
  const waits = calls.map((c) => Math.min(c.ms, c.s.timeout));    // each call is cut off at its own timeout
  const parts = [], degraded = [];
  let rawBytes = 0, failedRequired = false;
  calls.forEach((c) => {
    if (c.ms <= c.s.timeout) { parts.push(`${c.s.name}=${(user * 7 + c.s.name.length) % 100}`); rawBytes += RAW_EXTRA + SHOWN_BYTES; }
    else if (c.s.required) failedRequired = true;
    else degraded.push(c.s.name);
  });
  const body = parts.join(';');
  return {
    status: failedRequired ? 503 : 200, body, degraded, rawBytes,
    parallel: Math.max(...waits), sequential: waits.reduce((a, b) => a + b, 0), etag: etagOf(body),
  };
}

const N = 200, last = new Map();
const times = [], seq = [];
let ok = 0, partial = 0, errors = 0, notModified = 0, shaped = 0, wire = 0, raw = 0;
for (let i = 0; i < N; i++) {
  const user = i % USERS, version = i % 2 === 0 ? NEW_VERSION : OLD_VERSION;
  const r = handle(user, version);
  times.push(r.parallel); seq.push(r.sequential);
  if (r.status !== 200) { errors++; continue; }
  ok++; if (r.degraded.length) partial++;
  shaped += r.body.length; raw += r.rawBytes;
  if (last.get(user) === r.etag) notModified++;                   // the app sent If-None-Match, so the reply is 304 with no body
  else wire += r.body.length;
  last.set(user, r.etag);
}
times.sort((a, b) => a - b);
const mean = (a) => Math.floor(a.reduce((x, y) => x + y, 0) / a.length);
const p95 = times[Math.floor(N * 0.95)];
console.log(`requests ${N}: ${ok} ok (${partial} partial), ${errors} failed`);
console.log(`parallel mean ${mean(times)} ms, p95 ${p95} ms; one after another would average ${mean(seq)} ms`);
console.log(`not modified ${notModified}; bytes: ${raw} from the services, ${shaped} after shaping, ${wire} on the wire`);
console.log(`ETag of 'a=1': ${etagOf('a=1')}`);
if (p95 > P95_BUDGET_MS || mean(seq) <= mean(times) || shaped >= raw || wire >= shaped || ok + errors !== N || notModified === 0) process.exit(1);
