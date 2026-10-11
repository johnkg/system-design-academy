// A webhook sender in JavaScript: signed payloads (with a rotation window), a queue per endpoint with a
// concurrency limit, exponential backoff with jitter, and a circuit breaker, so a dead endpoint cannot hurt the others.
import crypto from 'node:crypto';

// The signature covers the timestamp and the exact body, so a captured request cannot be replayed later or edited.
const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const sameHex = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function verify(secret, header, ts, body, now, tolerance = 300) {
  if (Math.abs(now - ts) > tolerance) return false;                       // too old (or from the future)
  return header.split(',').some((sig) => sameHex(sig, sign(secret, ts, body))); // any listed signature may match
}

const LIMIT = 2, MAX_ATTEMPTS = 6, TRIP = 3, COOL = 20, END = 200, EPOCH = 1700000000;
let seed = 7;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const backoff = (attempt) => 1 + rnd(Math.min(30, 2 * 2 ** (attempt - 1))); // full jitter: anywhere from 1 to the cap

// The customer side. A receiver stores event ids, so a repeated delivery is ignored instead of processed twice.
const ROTATION = ['whsec_new', 'whsec_old']; // while a secret is rotated the sender signs with both
const endpoints = [
  { name: 'healthy', secret: 'whsec_new', act: () => 'ok' },
  { name: 'flaky', secret: 'whsec_old', act: (id, attempt) => (attempt > 1 ? 'ok' : id % 2 === 0 ? 'error' : id % 3 === 0 ? 'lost' : 'ok') },
  { name: 'dead', secret: 'whsec_new', act: () => 'hang' },
].map((e) => ({ ...e, queue: [], seen: new Set(), dupes: 0, delivered: 0, attempts: 0, dropped: 0, last: 0, fails: 0, openUntil: 0, opened: 0 }));

function receive(ep, id, attempt, ts, body, header) {
  if (!verify(ep.secret, header, ts, body, ts)) return 'error';
  const how = ep.act(id, attempt);
  if (how === 'ok' || how === 'lost') { if (ep.seen.has(id)) ep.dupes++; else ep.seen.add(id); } // 'lost' = processed, but the answer never arrived
  return how;
}

const bodyOf = (id) => `{"id":"evt_${id}","type":"invoice.paid","n":${id}}`;
for (const ep of endpoints) for (let id = 1; id <= 10; id++) ep.queue.push({ id, attempts: 0, readyAt: 0 }); // fan-out: one job per endpoint

for (let t = 0; t < END; t++) {
  for (const ep of endpoints) {                          // each endpoint has its own queue and its own limit
    if (ep.openUntil > t) continue;                      // breaker open: do not call it at all
    let slots = ep.fails >= TRIP ? 1 : LIMIT;            // half-open: a single probe
    for (const job of ep.queue.filter((j) => j.readyAt <= t)) {
      if (slots-- === 0) break;
      job.attempts++; ep.attempts++;
      const ts = EPOCH + t, body = bodyOf(job.id);
      const header = ROTATION.map((s) => sign(s, ts, body)).join(',');
      if (receive(ep, job.id, job.attempts, ts, body, header) === 'ok') {
        ep.queue.splice(ep.queue.indexOf(job), 1); ep.delivered++; ep.last = t; ep.fails = 0;
      } else {
        if (++ep.fails >= TRIP) { ep.openUntil = t + COOL; ep.opened++; }
        if (job.attempts >= MAX_ATTEMPTS) { ep.queue.splice(ep.queue.indexOf(job), 1); ep.dropped++; }
        else job.readyAt = t + backoff(job.attempts);
      }
    }
  }
}

const body = bodyOf(1), good = sign('whsec_demo', EPOCH, body);
console.log(`signature: ${good.slice(0, 16)}`);
const checks = [verify('whsec_demo', good, EPOCH, body, EPOCH + 10), verify('whsec_demo', good, EPOCH, body.replace('1', '9'), EPOCH + 10), verify('whsec_demo', good, EPOCH, body, EPOCH + 3600)];
console.log(`valid: ${checks[0]}, edited body: ${checks[1]}, stale timestamp: ${checks[2]}`);
for (const ep of endpoints) console.log(`${ep.name}: delivered ${ep.delivered}, attempts ${ep.attempts}, dropped ${ep.dropped}, waiting ${ep.queue.length}, duplicates ignored ${ep.dupes}, breaker opened ${ep.opened}, last delivery at ${ep.last}`);

const [h, f, d] = endpoints;
const fine = checks[0] && !checks[1] && !checks[2] && h.delivered === 10 && h.last <= 5 && h.attempts === 10 && f.delivered === 10 && f.seen.size === 10 && f.dupes > 0 &&
  d.delivered === 0 && d.attempts < 10 * MAX_ATTEMPTS && d.delivered + d.dropped + d.queue.length === 10;
console.log(`dead endpoint saw ${d.attempts} attempts, not ${10 * MAX_ATTEMPTS}; healthy finished by tick ${h.last}`);
if (!fine) process.exit(1);
