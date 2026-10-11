// Fan-out tail latency with and without hedged requests: a deterministic Monte Carlo with integer milliseconds.
// Backend model: 99% of calls take 6..14 ms (mean 10), 1% take 200..1000 ms. Load makes everything slower (M/M/1-style).
const TAIL_BP = 100; // 1% in basis points
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; }; };
const tailBp = (s) => Math.min(5000, Math.floor((TAIL_BP * s) / 1000)); // s = slowdown in milli (1000 = nominal)
const isTail = (r1, s) => r1 % 10000 < tailBp(s);
const latency = (r1, r2, r3, s) => isTail(r1, s) ? 200 + (r2 % 801) : Math.max(1, Math.floor(((6 + (r2 % 5) + (r3 % 5)) * s) / 1000));

// Exact percentile of ONE backend's latency (weighted points, no sampling noise): this is where the hedge delay comes from.
function delayFor(pct, s) {
  const tb = tailBp(s), pts = [];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) pts.push([Math.floor(((6 + a + b) * s) / 1000), (10000 - tb) * 801]);
  for (let k = 0; k < 801; k++) pts.push([200 + k, tb * 25]);
  pts.sort((x, y) => x[0] - y[0]);
  const total = 25 * 801 * 10000; let cum = 0;
  for (const [v, w] of pts) { cum += w; if (cum * 100 >= pct * total) return Math.max(1, v); }
  return pts[pts.length - 1][0];
}

// One shard call with R replicas. Copy k+1 is sent at k*delay if nothing has answered yet. Returns [latency, hedgesSent, primaryWasSlow].
function shardCall(next, st, delay, R, s) {
  const t = []; let tail1 = false;
  for (let k = 0; k < 3; k++) { const r1 = next(), r2 = next(), r3 = next(); if (k === 0) tail1 = isTail(r1, s); t.push(latency(r1, r2, r3, s)); }
  let done = t[0], hedges = 0;
  st.tokens = Math.min(10000, st.tokens + 50); // hedge budget: 5% of calls may hedge (shed the rest)
  for (let k = 1; k < R && delay > 0 && done > k * delay; k++) {
    if (st.budget && st.tokens < 1000) break; // load shedding: no budget, no hedge
    if (st.budget) st.tokens -= 1000;
    hedges++; done = Math.min(done, k * delay + t[k]);
  }
  return [done, hedges, tail1];
}

// Load feedback: hedges add traffic, utilisation rises, every backend slows down, more calls pass the delay.
function solve(delayPct, adaptive, R, rho, budget) {
  let s = 1000, extra = 0;
  if (delayPct === 0) return { s, delay: 0, extra };
  const d0 = delayFor(delayPct, 1000);
  for (let it = 0; it < 8; it++) {
    const d = adaptive ? delayFor(delayPct, s) : d0, next = lcg(777), st = { tokens: 0, budget }; let h = 0;
    for (let i = 0; i < 20000; i++) h += shardCall(next, st, d, R, s)[1];
    extra = Math.floor((h * 1000) / 20000); // extra requests per 1000 primary calls
    const effPm = Math.min(980, Math.floor((rho * (1000 + extra)) / 100));
    s = Math.floor(((1000 - rho * 10) * 1000) / (1000 - effPm));
  }
  return { s, delay: adaptive ? delayFor(delayPct, s) : d0, extra };
}

function run(fanout, delayPct, R, rho, { adaptive = false, budget = false, n = 2000 } = {}) {
  const { s, delay, extra } = solve(delayPct, adaptive, R, rho, budget);
  const next = lcg(12345), st = { tokens: 0, budget }, lat = []; let hedges = 0, hitSlow = 0;
  for (let i = 0; i < n; i++) {
    let worst = 0, slow = false;
    for (let j = 0; j < fanout; j++) { const [l, h, t] = shardCall(next, st, delay, R, s); worst = Math.max(worst, l); hedges += h; slow = slow || t; }
    lat.push(worst); if (slow) hitSlow++;
  }
  lat.sort((a, b) => a - b);
  const pct = (p) => lat[Math.floor((p * n + 99) / 100) - 1];
  return { p50: pct(50), p95: pct(95), p99: pct(99), delay, s, hitSlowPct: Math.floor((hitSlow * 100) / n), extraPm: Math.floor((hedges * 1000) / (n * fanout)) };
}

const show = (label, r) => console.log(`${label.padEnd(26)} p50=${String(r.p50).padStart(3)} p95=${String(r.p95).padStart(4)} p99=${String(r.p99).padStart(4)} hit-slow=${String(r.hitSlowPct).padStart(2)}% hedge-delay=${String(r.delay).padStart(3)}ms extra-load=${Math.floor(r.extraPm / 10)}.${r.extraPm % 10}%`);
console.log('1 - 0.99^N: ' + [1, 10, 50, 100].map((f) => `N=${f} ${Math.floor(100 * (1 - Math.pow(0.99, f)))}%`).join(', '));
const off = run(50, 0, 2, 50), p95 = run(50, 95, 2, 50), p50 = run(50, 50, 2, 50), p95b = run(50, 95, 2, 50, { budget: true });
console.log('fan-out 50 shards, 50% load, 2 replicas');
show('no hedging', off); show('hedge after p95', p95); show('hedge after p95 + budget', p95b); show('hedge after p50', p50);
const lone = run(1, 0, 2, 50), loneH = run(1, 95, 2, 50);
console.log('fan-out 1'); show('no hedging', lone); show('hedge after p95', loneH);
console.log('p95 delay ' + delayFor(95, 1000) + ' ms, p50 delay ' + delayFor(50, 1000) + ' ms');

if (!(p95.p99 < off.p99)) throw new Error('hedging at p95 must reduce p99');
if (!(p95.extraPm < 100)) throw new Error('hedging at p95 must add under 10% load');
if (!(p50.extraPm > 3 * p95.extraPm)) throw new Error('hedging at p50 must cost far more than at p95');
if (!(p95b.extraPm <= 50)) throw new Error('the budget must cap the extra load at 5%');
console.log('invariants hold');
