// An authoritative DNS answerer in JavaScript:
// zone data with failover and weighted policies, health checks, a resolver cache that shows how TTL controls failover time,
// and response rate limiting (RRL) against a spoofed amplification attack.

const fnv = (s) => { let h = 0x811c9dc5; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }; // 32-bit FNV-1a hash
const DEFAULT_TTL = 300, CDN_TTL = 60, CLIENTS = 10000;
const CHECK_INTERVAL = 10, FAIL_THRESHOLD = 3; // health checks every 10 s, 3 failures in a row mark the address down
const RRL_LIMIT = 5; // full answers per second per (client prefix, name)
const ATTACK_SECONDS = 3, ATTACK_QPS = 1000, LEGIT_QPS = 2;
const ANSWER_BYTES = 1400, SLIP_BYTES = 90, QUERY_BYTES = 70; // a signed answer, a truncated reply, a spoofed query
const MIN_REDUCTION = 20; // RRL must cut the reflected bytes at least 20-fold
const NEG_TTL = 60;          // how long resolvers may cache "no such name" (the SOA minimum)
const PRIMARY = '192.0.2.10';
const ZONE = {
  'www.example.com': { kind: 'failover', ips: [PRIMARY, '198.51.100.20'], weights: [1, 1] },
  'cdn.example.com': { kind: 'weighted', ips: ['203.0.113.1', '203.0.113.2', '203.0.113.3'], weights: [70, 20, 10] },
  'mail.example.com': { kind: 'static', ips: ['192.0.2.50'], weights: [1] },
};

// Answer one query from memory. `down` is the set of addresses the health checkers have marked unhealthy.
function resolve(name, client, down, ttl) {
  const rec = ZONE[name];
  if (!rec) return { rcode: 'NXDOMAIN', ips: [], ttl: NEG_TTL };
  let alive = rec.ips.map((_, i) => i).filter((i) => !down.has(rec.ips[i]));
  if (alive.length === 0) alive = rec.ips.map((_, i) => i);  // everything looks down: fail open and answer anyway
  let chosen = alive;
  if (rec.kind === 'failover') chosen = [alive[0]];           // the first healthy address in priority order
  if (rec.kind === 'weighted') {                              // the same client always gets the same pick, so answers are stable
    const total = alive.reduce((s, i) => s + rec.weights[i], 0);
    let r = fnv(`${name}|${client}`) % total;
    chosen = [alive.find((i) => (r -= rec.weights[i]) < 0)];
  }
  return { rcode: 'NOERROR', ips: chosen.map((i) => rec.ips[i]), ttl };
}

// One resolver asks for www once a second. A failure starts at t=100 and health checks run every `interval` seconds.
function failover(ttl, interval, threshold) {
  const FAIL_AT = 100, PROPAGATION = 5, END = 4000;
  const down = new Set();
  let consecutive = 0, markedAt = -1, bad = 0, fetches = 0, cache = null;
  for (let t = 0; t < END; t++) {
    if (t % interval === 0) {
      consecutive = t >= FAIL_AT ? consecutive + 1 : 0;
      if (consecutive === threshold) markedAt = t;
    }
    if (markedAt >= 0 && t === markedAt + PROPAGATION) down.add(PRIMARY); // the change reaches every name server a few seconds later
    if (!cache || t >= cache.expires) {
      const a = resolve('www.example.com', 'r1', down, ttl);
      cache = { ip: a.ips[0], expires: t + a.ttl };
      fetches++;
    }
    if (t >= FAIL_AT && cache.ip === PRIMARY) bad++;
  }
  return { markedAt, bad, fetches };
}

// Response rate limiting: at most `limit` full answers per second for each (client prefix, name).
// Of the excess, every second one becomes a tiny truncated reply (a real client retries over TCP), the others are dropped.
class Limiter {
  constructor(limit) { this.limit = limit; this.seen = new Map(); }
  check(prefix, name, sec) {
    const key = `${prefix}|${name}|${sec}`;
    const n = (this.seen.get(key) || 0) + 1;
    this.seen.set(key, n);
    if (n <= this.limit) return 'answer';
    return (n - this.limit) % 2 === 0 ? 'slip' : 'drop';
  }
}

function attack(rrl) {
  const limiter = rrl ? new Limiter(RRL_LIMIT) : null;
  const victim = { answer: 0, slip: 0, drop: 0 }, legit = { answer: 0, slip: 0, drop: 0 };
  for (let sec = 0; sec < ATTACK_SECONDS; sec++) {
    for (let i = 0; i < ATTACK_QPS; i++) victim[limiter ? limiter.check('198.51.100.0/24', 'www.example.com', sec) : 'answer']++; // spoofed source = the victim
    for (let i = 0; i < LEGIT_QPS; i++) legit[limiter ? limiter.check('203.0.113.0/24', 'www.example.com', sec) : 'answer']++;
  }
  const bytes = victim.answer * ANSWER_BYTES + victim.slip * SLIP_BYTES;
  return { victim, legit, bytes, amplification: (bytes / (ATTACK_SECONDS * ATTACK_QPS * QUERY_BYTES)).toFixed(2) }; // bytes out per byte the attacker sent
}

const none = new Set();
for (const name of ['www.example.com', 'mail.example.com', 'nope.example.com']) {
  const a = resolve(name, 'r1', none, DEFAULT_TTL);
  console.log(`${name} -> ${a.rcode} ${a.ips.join(',')} ttl ${a.ttl}`);
}
console.log(`www with the primary down -> ${resolve('www.example.com', 'r1', new Set([PRIMARY]), DEFAULT_TTL).ips.join(',')}`);
console.log(`everything down fails open -> ${resolve('www.example.com', 'r1', new Set(ZONE['www.example.com'].ips), DEFAULT_TTL).ips.join(',')}`);

const count = (down) => { // how 10,000 different clients are spread over the three addresses
  const c = {};
  for (let i = 0; i < CLIENTS; i++) { const ip = resolve('cdn.example.com', `c${i}`, down, CDN_TTL).ips[0]; c[ip] = (c[ip] || 0) + 1; }
  return c;
};
const show = (c) => Object.keys(c).sort().map((ip) => `${ip}=${c[ip]}`).join(' ');
const split = count(none), split2 = count(new Set(['203.0.113.1']));
console.log(`weighted 70/20/10: ${show(split)}`);
console.log(`weighted, first one down: ${show(split2)}`);

const results = {};
for (const ttl of [30, 60, 300, 3600]) {
  const r = failover(ttl, CHECK_INTERVAL, FAIL_THRESHOLD); results[ttl] = r;
  console.log(`ttl ${ttl}: marked down at ${r.markedAt}, users on the dead address for ${r.bad} s, ${r.fetches} queries to the name server`);
}
const off = attack(false), on = attack(true);
for (const [label, r] of [['off', off], ['on', on]]) {
  console.log(`RRL ${label}: victim gets ${r.victim.answer} answers, ${r.victim.slip} truncated, ${r.victim.drop} dropped = ${r.bytes} bytes (${r.amplification}x); real resolver answered ${r.legit.answer}/6`);
}

const ok = results[30].markedAt === 120 && results[30].bad === 50 && results[60].bad === 80 && results[300].bad === 200 && results[3600].bad === 3500
  && Math.abs(split['203.0.113.1'] - 7000) < 400 && Math.abs(split['203.0.113.2'] - 2000) < 300 && Math.abs(split['203.0.113.3'] - 1000) < 250 && split2['203.0.113.1'] === undefined
  && off.victim.answer === 3000 && on.victim.answer === 15 && on.victim.slip + on.victim.drop === 2985 && on.legit.answer === 6 && on.bytes * MIN_REDUCTION < off.bytes;
if (!ok) process.exit(1);
