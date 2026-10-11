// A client-side mesh proxy in JavaScript: it balances by least request (power of two choices),
// ejects a pod after 5 errors in a row, and retries only while retries stay under 20% of the requests.

const PODS = 5, TICKS = 300, PER_TICK = 2, BAD_POD = 3, BAD_FROM = 50, OUTAGE_FROM = 200, OUTAGE_TO = 220;
const HOLD = [2, 5, 2, 2, 2]; // ticks a request stays in flight; pod 1 is slow
const MAX_RETRIES = 3, EJECT_AFTER = 5, EJECT_TICKS = 30;

let seed = 7;
const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };

function run(eject, budget) {
  seed = 7;
  const active = new Array(PODS).fill(0), consecutive = new Array(PODS).fill(0), ejectedUntil = new Array(PODS).fill(0);
  const sent = new Array(PODS).fill(0), releases = Array.from({ length: TICKS + 10 }, () => []);
  const r = { requests: 0, ok: 0, attempts: 0, retries: 0, ejections: 0, denied: 0, badBefore: 0 };

  // Power of two choices: draw two candidate pods and take the one with fewer requests in flight.
  function pick(t, tried) {
    let pool = [...Array(PODS).keys()].filter((p) => ejectedUntil[p] <= t && !tried.includes(p));
    if (pool.length === 0) pool = [...Array(PODS).keys()].filter((p) => !tried.includes(p)); // panic mode: use ejected pods too
    const a = pool[random(pool.length)], b = pool[random(pool.length)];
    return active[b] < active[a] ? b : a;
  }

  for (let t = 0; t < TICKS; t++) {
    for (const p of releases[t]) active[p]--;
    for (let i = 0; i < PER_TICK; i++) {
      r.requests++;
      const tried = [];
      for (let k = 0; k <= MAX_RETRIES; k++) {
        const p = pick(t, tried);
        if (p === BAD_POD && t >= BAD_FROM && t < OUTAGE_FROM) r.badBefore++; // attempts that reached the bad pod before the outage
        r.attempts++; sent[p]++; active[p]++; releases[t + HOLD[p]].push(p);
        const down = (t >= OUTAGE_FROM && t < OUTAGE_TO) || (p === BAD_POD && t >= BAD_FROM);
        if (!down) { consecutive[p] = 0; r.ok++; break; }
        consecutive[p]++;
        if (eject && consecutive[p] >= EJECT_AFTER) { ejectedUntil[p] = t + EJECT_TICKS; consecutive[p] = 0; r.ejections++; }
        tried.push(p);
        if (k === MAX_RETRIES) break;
        if (budget && (r.retries + 1) * 5 > r.requests) { r.denied++; break; } // the budget: retries <= 20% of requests
        r.retries++;
      }
    }
  }
  return { ...r, sent };
}

const modes = [['plain', false, false], ['eject', true, false], ['budget', false, true], ['eject+budget', true, true]];
const result = {};
for (const [name, eject, budget] of modes) {
  const r = run(eject, budget);
  result[name] = r;
  console.log(`${name.padEnd(13)} ok ${r.ok}/${r.requests}, attempts ${r.attempts}, retries ${r.retries}, denied ${r.denied}, ejections ${r.ejections}, per pod [${r.sent.join(', ')}]`);
}

const { plain, eject, budget } = result, both = result['eject+budget'];
console.log(`bad pod ${BAD_POD} got ${plain.badBefore} attempts before the outage in plain mode and ${eject.badBefore} with ejection`);
console.log(`amplification: ${(plain.attempts / plain.requests).toFixed(2)} plain, ${(both.attempts / both.requests).toFixed(2)} with ejection and budget`);

const checks = [
  eject.badBefore * 2 < plain.badBefore,           // ejection stops most traffic to the bad pod
  budget.retries * 5 <= budget.requests,                // the budget bounds retries to 20% of requests
  both.attempts < plain.attempts,                       // less wasted work
  plain.ok > plain.requests * 0.9 && both.ok > 0,       // retries still hide the one bad pod
];
if (checks.includes(false)) { console.log('invariant failed', checks); process.exit(1); }
