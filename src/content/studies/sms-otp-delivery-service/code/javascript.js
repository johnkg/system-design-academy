// An SMS and one-time-password pipeline, in JavaScript:
// dedupe by key, a pumping guard, cheapest-first routing with failover and circuit breakers, then OTP checks.

const SEED = 7, PER_MILLE = 1000;
const OUTAGE_FROM = 800, OUTAGE_TO = 1600;      // provider A is down for these requests
const BREAKER_FAILS = 5, COOL_DOWN = 200;       // failures in a row that open a breaker, requests it stays open
const REQUESTS = 3000, RETRY_EVERY = 10;        // every 10th request is a client retry
const ATTACK_FROM = 1000, ATTACK_EVERY = 5, PREMIUM = 2, STANDARD_PERCENT = 80;
// The pumping guard: after 30 sends to a range, block it if fewer than 1 in 10 codes were verified.
const GUARD_MIN_SENT = 30, GUARD_RATIO = 10, VERIFY_PERCENT = 85;
// OTPs: 6 digits, valid for 300 s, 5 tries; the salt is folded in with a multiplier before hashing.
const HALF_WORD = 65536, CODE_SPACE = 1000000, OTP_TTL = 300, MAX_TRIES = 5, SALT_MIX = 40503;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 16; };
const mix = (x) => { // a small integer hash (a real service uses HMAC-SHA256 with a secret key)
  x = Math.imul((x >>> 0) ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};

// price is in hundredths of a cent per message; good is deliveries per 1000 when healthy
const providers = [['A', 450, 970], ['B', 600, 985], ['C', 900, 995]].map(([name, price, good]) => (
  { name, price, good, fails: 0, until: 0, tries: 0, ok: 0, opens: 0 }));
const MULT = [1, 2, 12]; // price factor per destination range; range 2 is a premium range that pumping attackers abuse

function attempt(p, i) {
  const roll = next() % PER_MILLE;
  const up = !(p.name === 'A' && i >= OUTAGE_FROM && i < OUTAGE_TO); // provider A is down for requests 800 to 1599
  return up && roll < p.good;
}

// Cheapest first. A provider whose breaker is open is skipped until its cool-down ends, then it gets one trial.
function route(i, prefix, stats) {
  for (const p of providers) {
    if (i < p.until) continue;
    p.tries++;
    if (attempt(p, i)) { p.fails = 0; p.ok++; stats.spend += p.price * MULT[prefix]; return p; }
    if (++p.fails >= BREAKER_FAILS) { p.until = i + COOL_DOWN; p.opens++; } // open the breaker; one more failure re-opens it after a trial
    stats.failovers++;
  }
  return null;
}

const stats = { dupes: 0, blocked: 0, saved: 0, delivered: 0, lost: 0, failovers: 0, spend: 0 };
const seen = new Set();
const ranges = MULT.map(() => ({ sent: 0, ok: 0 }));
for (let i = 0; i < REQUESTS; i++) {
  const key = i % RETRY_EVERY === RETRY_EVERY - 1 ? i - 1 : i; // every 10th request is a client retry of the one before it
  if (seen.has(key)) { stats.dupes++; continue; }
  seen.add(key);
  const attacker = i >= ATTACK_FROM && i % ATTACK_EVERY === 3;
  const prefix = attacker ? PREMIUM : next() % 100 < STANDARD_PERCENT ? 0 : 1;
  const r = ranges[prefix];
  if (r.sent >= GUARD_MIN_SENT && r.ok * GUARD_RATIO < r.sent) { stats.blocked++; stats.saved += providers[0].price * MULT[prefix]; continue; } // under 10% verified
  r.sent++;
  if (route(i, prefix, stats)) {
    stats.delivered++;
    if (!attacker && next() % 100 < VERIFY_PERCENT) r.ok++; // a real user types the code in; a pumping bot never does
  } else stats.lost++;
}
console.log(`requests 3000, duplicate keys ignored ${stats.dupes}, blocked by the pumping guard ${stats.blocked} (saves ${stats.saved})`);
for (const p of providers) console.log(`${p.name}: ${p.ok} delivered of ${p.tries} tries, breaker opened ${p.opens} times`);
console.log(`delivered ${stats.delivered}, lost ${stats.lost}, failovers ${stats.failovers}, spend ${stats.spend}`);
if (stats.delivered + stats.lost + stats.blocked + stats.dupes !== REQUESTS) process.exit(1);

// One-time passwords: 6 digits, kept only as a salted hash, valid for 300 s, 5 wrong guesses, then locked.
const issue = (now) => {
  const code = (next() * HALF_WORD + next()) % CODE_SPACE, salt = next();
  return { code, rec: { salt, hash: mix(code ^ Math.imul(salt, SALT_MIX)), expires: now + OTP_TTL, tries: 0, used: false } };
};
const verify = (rec, guess, now) => {
  if (rec.used) return 'used';
  if (now > rec.expires) return 'expired';
  if (rec.tries >= MAX_TRIES) return 'locked';
  rec.tries++;
  if (mix(guess ^ Math.imul(rec.salt, SALT_MIX)) !== rec.hash) return 'wrong';
  rec.used = true;
  return 'ok';
};
let a = issue(0), b = issue(0), c = issue(0);
const guessing = Array.from({ length: MAX_TRIES + 1 }, (_, k) => k + 1)
  .map((n) => verify(a.rec, n === MAX_TRIES + 1 ? a.code : (a.code + n) % CODE_SPACE, n));
const results = [guessing.join(','), verify(b.rec, b.code, 299) + ',' + verify(b.rec, b.code, 300), verify(c.rec, c.code, 301)];
console.log(`six guesses, last one right: ${results[0]}`);
console.log(`right at 299 s then again: ${results[1]}; right at 301 s: ${results[2]}`);
if (results[0] !== 'wrong,wrong,wrong,wrong,wrong,locked' || results[1] !== 'ok,used' || results[2] !== 'expired') process.exit(1);
