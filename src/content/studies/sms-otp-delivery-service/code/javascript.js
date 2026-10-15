// An SMS and one-time-password pipeline, in JavaScript:
// dedupe by key, a pumping guard, cheapest-first routing with failover and circuit breakers, then OTP checks.

let seed = 7;
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
  const roll = next() % 1000;
  const up = !(p.name === 'A' && i >= 800 && i < 1600); // provider A is down for requests 800 to 1599
  return up && roll < p.good;
}

// Cheapest first. A provider whose breaker is open is skipped until its cool-down ends, then it gets one trial.
function route(i, prefix, stats) {
  for (const p of providers) {
    if (i < p.until) continue;
    p.tries++;
    if (attempt(p, i)) { p.fails = 0; p.ok++; stats.spend += p.price * MULT[prefix]; return p; }
    if (++p.fails >= 5) { p.until = i + 200; p.opens++; } // open the breaker; one more failure re-opens it after a trial
    stats.failovers++;
  }
  return null;
}

const stats = { dupes: 0, blocked: 0, saved: 0, delivered: 0, lost: 0, failovers: 0, spend: 0 };
const seen = new Set();
const ranges = MULT.map(() => ({ sent: 0, ok: 0 }));
for (let i = 0; i < 3000; i++) {
  const key = i % 10 === 9 ? i - 1 : i; // every 10th request is a client retry of the one before it
  if (seen.has(key)) { stats.dupes++; continue; }
  seen.add(key);
  const attacker = i >= 1000 && i % 5 === 3;
  const prefix = attacker ? 2 : next() % 100 < 80 ? 0 : 1;
  const r = ranges[prefix];
  if (r.sent >= 30 && r.ok * 10 < r.sent) { stats.blocked++; stats.saved += providers[0].price * MULT[prefix]; continue; } // under 10% verified
  r.sent++;
  if (route(i, prefix, stats)) {
    stats.delivered++;
    if (!attacker && next() % 100 < 85) r.ok++; // a real user types the code in; a pumping bot never does
  } else stats.lost++;
}
console.log(`requests 3000, duplicate keys ignored ${stats.dupes}, blocked by the pumping guard ${stats.blocked} (saves ${stats.saved})`);
for (const p of providers) console.log(`${p.name}: ${p.ok} delivered of ${p.tries} tries, breaker opened ${p.opens} times`);
console.log(`delivered ${stats.delivered}, lost ${stats.lost}, failovers ${stats.failovers}, spend ${stats.spend}`);
if (stats.delivered + stats.lost + stats.blocked + stats.dupes !== 3000) process.exit(1);

// One-time passwords: 6 digits, kept only as a salted hash, valid for 300 s, 5 wrong guesses, then locked.
const issue = (now) => {
  const code = (next() * 65536 + next()) % 1000000, salt = next();
  return { code, rec: { salt, hash: mix(code ^ Math.imul(salt, 40503)), expires: now + 300, tries: 0, used: false } };
};
const verify = (rec, guess, now) => {
  if (rec.used) return 'used';
  if (now > rec.expires) return 'expired';
  if (rec.tries >= 5) return 'locked';
  rec.tries++;
  if (mix(guess ^ Math.imul(rec.salt, 40503)) !== rec.hash) return 'wrong';
  rec.used = true;
  return 'ok';
};
let a = issue(0), b = issue(0), c = issue(0);
const guessing = [1, 2, 3, 4, 5, 6].map((n) => verify(a.rec, n === 6 ? a.code : (a.code + n) % 1000000, n));
const results = [guessing.join(','), verify(b.rec, b.code, 299) + ',' + verify(b.rec, b.code, 300), verify(c.rec, c.code, 301)];
console.log(`six guesses, last one right: ${results[0]}`);
console.log(`right at 299 s then again: ${results[1]}; right at 301 s: ${results[2]}`);
if (results[0] !== 'wrong,wrong,wrong,wrong,wrong,locked' || results[1] !== 'ok,used' || results[2] !== 'expired') process.exit(1);
