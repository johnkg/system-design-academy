// Fan-out tail latency with and without hedged requests: a deterministic Monte Carlo with integer milliseconds.
// Backend model: 99% of calls take 6..14 ms (mean 10), 1% take 200..1000 ms. Load makes everything slower (M/M/1-style).
const TAIL_BP = 100; // 1% in basis points
const BP_SCALE = 10000; // basis points in 100%
const MILLI = 1000; // slowdown s and loads are in thousandths (1000 = nominal)
const MAX_TAIL_BP = 5000; // the slow tail never exceeds half of all calls
const FAST_MIN_MS = 6; // fast calls: 6 ms plus two draws of 0..4 ms
const FAST_STEPS = 5;
const TAIL_MIN_MS = 200; // slow calls: 200..1000 ms
const TAIL_SPAN = 801;
const COPIES = 3; // latencies drawn per shard call, one per possible replica
const BUDGET_CAP = 10000; // hedge budget in tokens: each call earns 50, a hedge costs 1000, so 5% of calls may hedge
const BUDGET_EARN = 50;
const HEDGE_COST = 1000;
const SOLVE_ROUNDS = 8; // fixed-point iterations of the load feedback
const SOLVE_CALLS = 20000; // shard calls sampled per iteration
const SOLVE_SEED = 777;
const MAX_UTIL_PM = 980; // utilisation is capped at 98%
const RUN_SEED = 12345;
const RUN_CALLS = 2000; // fan-out requests per run
const FANOUT = 50; // demo: shards per request, load in percent, replicas per shard
const LOAD_PCT = 50;
const REPLICAS = 2;
const MAX_HEDGE_LOAD_PM = 100; // hedging at p95 must add under 10% load
const P50_COST_RATIO = 3; // hedging at p50 must cost at least this many times more
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; }; };
const tailBp = (s) => Math.min(MAX_TAIL_BP, Math.floor((TAIL_BP * s) / MILLI)); // s = slowdown in milli (1000 = nominal)
const isTail = (r1, s) => r1 % BP_SCALE < tailBp(s);
const latency = (r1, r2, r3, s) => isTail(r1, s) ? TAIL_MIN_MS + (r2 % TAIL_SPAN) : Math.max(1, Math.floor(((FAST_MIN_MS + (r2 % FAST_STEPS) + (r3 % FAST_STEPS)) * s) / MILLI));

// Exact percentile of ONE backend's latency (weighted points, no sampling noise): this is where the hedge delay comes from.
function delayFor(pct, s) {
  const tb = tailBp(s), pts = [];
  for (let a = 0; a < FAST_STEPS; a++) for (let b = 0; b < FAST_STEPS; b++) pts.push([Math.floor(((FAST_MIN_MS + a + b) * s) / MILLI), (BP_SCALE - tb) * TAIL_SPAN]);
  for (let k = 0; k < TAIL_SPAN; k++) pts.push([TAIL_MIN_MS + k, tb * FAST_STEPS * FAST_STEPS]);
  pts.sort((x, y) => x[0] - y[0]);
  const total = FAST_STEPS * FAST_STEPS * TAIL_SPAN * BP_SCALE; let cum = 0;
  for (const [v, w] of pts) { cum += w; if (cum * 100 >= pct * total) return Math.max(1, v); }
  return pts[pts.length - 1][0];
}

// One shard call with R replicas. Copy k+1 is sent at k*delay if nothing has answered yet. Returns [latency, hedgesSent, primaryWasSlow].
function shardCall(next, st, delay, R, s) {
  const t = []; let tail1 = false;
  for (let k = 0; k < COPIES; k++) { const r1 = next(), r2 = next(), r3 = next(); if (k === 0) tail1 = isTail(r1, s); t.push(latency(r1, r2, r3, s)); }
  let done = t[0], hedges = 0;
  st.tokens = Math.min(BUDGET_CAP, st.tokens + BUDGET_EARN); // hedge budget: 5% of calls may hedge (shed the rest)
  for (let k = 1; k < R && delay > 0 && done > k * delay; k++) {
    if (st.budget && st.tokens < HEDGE_COST) break; // load shedding: no budget, no hedge
    if (st.budget) st.tokens -= HEDGE_COST;
    hedges++; done = Math.min(done, k * delay + t[k]);
  }
  return [done, hedges, tail1];
}

// Load feedback: hedges add traffic, utilisation rises, every backend slows down, more calls pass the delay.
function solve(delayPct, adaptive, R, rho, budget) {
  let s = MILLI, extra = 0;
  if (delayPct === 0) return { s, delay: 0, extra };
  const d0 = delayFor(delayPct, MILLI);
  for (let it = 0; it < SOLVE_ROUNDS; it++) {
    const d = adaptive ? delayFor(delayPct, s) : d0, next = lcg(SOLVE_SEED), st = { tokens: 0, budget }; let h = 0;
    for (let i = 0; i < SOLVE_CALLS; i++) h += shardCall(next, st, d, R, s)[1];
    extra = Math.floor((h * MILLI) / SOLVE_CALLS); // extra requests per 1000 primary calls
    const effPm = Math.min(MAX_UTIL_PM, Math.floor((rho * (MILLI + extra)) / 100));
    s = Math.floor(((MILLI - rho * (MILLI / 100)) * MILLI) / (MILLI - effPm));
  }
  return { s, delay: adaptive ? delayFor(delayPct, s) : d0, extra };
}

function run(fanout, delayPct, R, rho, { adaptive = false, budget = false, n = RUN_CALLS } = {}) {
  const { s, delay, extra } = solve(delayPct, adaptive, R, rho, budget);
  const next = lcg(RUN_SEED), st = { tokens: 0, budget }, lat = []; let hedges = 0, hitSlow = 0;
  for (let i = 0; i < n; i++) {
    let worst = 0, slow = false;
    for (let j = 0; j < fanout; j++) { const [l, h, t] = shardCall(next, st, delay, R, s); worst = Math.max(worst, l); hedges += h; slow = slow || t; }
    lat.push(worst); if (slow) hitSlow++;
  }
  lat.sort((a, b) => a - b);
  const pct = (p) => lat[Math.floor((p * n + 99) / 100) - 1];
  return { p50: pct(50), p95: pct(95), p99: pct(99), delay, s, hitSlowPct: Math.floor((hitSlow * 100) / n), extraPm: Math.floor((hedges * MILLI) / (n * fanout)) };
}

const show = (label, r) => console.log(`${label.padEnd(26)} p50=${String(r.p50).padStart(3)} p95=${String(r.p95).padStart(4)} p99=${String(r.p99).padStart(4)} hit-slow=${String(r.hitSlowPct).padStart(2)}% hedge-delay=${String(r.delay).padStart(3)}ms extra-load=${Math.floor(r.extraPm / 10)}.${r.extraPm % 10}%`);
console.log('1 - 0.99^N: ' + [1, 10, 50, 100].map((f) => `N=${f} ${Math.floor(100 * (1 - Math.pow(0.99, f)))}%`).join(', '));
const off = run(FANOUT, 0, REPLICAS, LOAD_PCT), p95 = run(FANOUT, 95, REPLICAS, LOAD_PCT), p50 = run(FANOUT, 50, REPLICAS, LOAD_PCT), p95b = run(FANOUT, 95, REPLICAS, LOAD_PCT, { budget: true });
console.log('fan-out 50 shards, 50% load, 2 replicas');
show('no hedging', off); show('hedge after p95', p95); show('hedge after p95 + budget', p95b); show('hedge after p50', p50);
const lone = run(1, 0, REPLICAS, LOAD_PCT), loneH = run(1, 95, REPLICAS, LOAD_PCT);
console.log('fan-out 1'); show('no hedging', lone); show('hedge after p95', loneH);
console.log('p95 delay ' + delayFor(95, MILLI) + ' ms, p50 delay ' + delayFor(50, MILLI) + ' ms');

if (!(p95.p99 < off.p99)) throw new Error('hedging at p95 must reduce p99');
if (!(p95.extraPm < MAX_HEDGE_LOAD_PM)) throw new Error('hedging at p95 must add under 10% load');
if (!(p50.extraPm > P50_COST_RATIO * p95.extraPm)) throw new Error('hedging at p50 must cost far more than at p95');
if (!(p95b.extraPm <= BUDGET_EARN * MILLI / HEDGE_COST)) throw new Error('the budget must cap the extra load at 5%');
console.log('invariants hold');
