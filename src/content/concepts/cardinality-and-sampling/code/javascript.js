// Cost of labels and sampling: series cardinality, head vs tail sampling, and reweighted estimators.
// Integer-only random numbers so the output is identical in every language.
const N = 100000;       // 2 seconds of traffic at 50,000 requests per second
const SLOW_MS = 800;    // tail sampling keeps anything at least this slow
const SEED = 5;

function mix(x) { // 32-bit hash finalizer (murmur3)
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
function makeStream(n, seed) { // 0.2% errors (slow timeouts), 1% slow successes, the rest fast
  const rng = mulberry32(seed), out = [];
  for (let i = 0; i < n; i++) {
    const id = rng(), u = rng() % 100000;
    let ms, err = false;
    if (u < 200) { err = true; ms = 1500 + (rng() % 2500); }
    else if (u < 1200) ms = SLOW_MS + (rng() % 2200);
    else ms = 20 + (rng() % 60) + (rng() % 60) + (rng() % 60);
    out.push({ id, err, ms });
  }
  return out;
}
// Head sampling: a pure function of the trace id, so every service decides the same way.
const headKeep = (id, d, salt = 0x9e3779b9) => mix((id ^ salt) >>> 0) < Math.floor(4294967296 / d);
const isInteresting = (e) => e.err || e.ms >= SLOW_MS;

function weightedQuantile(items, pct) { // items: [ms, weight]; smallest ms with >= pct% of the weight below
  items.sort((a, b) => a[0] - b[0]);
  const total = items.reduce((s, x) => s + x[1], 0);
  let cum = 0;
  for (const [ms, w] of items) { cum += w; if (cum * 100 >= pct * total) return ms; }
}
function wilson(k, n) { // 95% interval for a proportion
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [c - h, c + h];
}

const stream = makeStream(N, SEED);
const trueErrors = stream.filter((e) => e.err).length;
const trueP99 = weightedQuantile(stream.map((e) => [e.ms, 1]), 99);
console.log(`stream: ${N} requests, ${trueErrors} errors, true p99 ${trueP99} ms`);

function run(d, tail) {
  const kept = stream.filter((e) => headKeep(e.id, d) || (tail && isInteresting(e)));
  const errsKept = kept.filter((e) => e.err).length;
  const weight = (e) => (tail && isInteresting(e) ? 1 : d); // each kept event stands for 1/rate events
  const estTotal = kept.reduce((s, e) => s + weight(e), 0);
  const normalKept = kept.filter((e) => !(tail && isInteresting(e))).length;
  const se = Math.sqrt(normalKept * d * (d - 1)); // std dev of the reweighted total
  const p99 = weightedQuantile(kept.map((e) => [e.ms, weight(e)]), 99);
  const naive = weightedQuantile(kept.map((e) => [e.ms, 1]), 99);
  const relErr = ((estTotal - N) / N) * 100;
  let rate;
  if (tail) rate = errsKept / estTotal; // errors are exact, only the denominator is estimated
  else rate = kept.length ? errsKept / kept.length : 0;
  const ci = tail ? [errsKept / (estTotal + 1.96 * se), errsKept / (estTotal - 1.96 * se)] : wilson(errsKept, kept.length);
  const pc = (x) => (x * 100).toFixed(3);
  console.log(`${tail ? 'tail' : 'head'} 1/${d}: kept ${kept.length}, errors kept ${errsKept}/${trueErrors}, count est ${estTotal} (${relErr.toFixed(2)}%), ` +
    `error rate ${pc(rate)}% [${pc(ci[0])}, ${pc(ci[1])}], p99 ${p99} ms, unweighted p99 ${naive} ms`);
  return { kept, errsKept, estTotal, se, relErr, p99 };
}

for (const d of [1, 10, 100, 1000]) {
  const r = run(d, false);
  if (Math.abs(r.estTotal - N) > 4 * r.se) throw new Error(`head 1/${d} count estimate off`);
  if (d === 1 && r.errsKept !== trueErrors) throw new Error('keep-everything must keep every error');
}
for (const d of [10, 100, 1000]) {
  const r = run(d, true);
  if (r.errsKept !== trueErrors) throw new Error('tail sampling lost an error');
  if (Math.abs(r.estTotal - N) > 4 * r.se) throw new Error(`tail 1/${d} count estimate off`);
}

// Three services on the request path, each deciding at 1/10.
const consistent = stream.filter((e) => headKeep(e.id, 10) && headKeep(e.id, 10) && headKeep(e.id, 10)).length;
const independent = stream.filter((e) => headKeep(e.id, 10, 1) && headKeep(e.id, 10, 2) && headKeep(e.id, 10, 3)).length;
console.log(`complete traces across 3 services at 1/10: by trace id ${consistent}, independent coins ${independent}`);
if (consistent <= independent) throw new Error('consistent sampling must keep more complete traces');

// Metric cardinality: one series per unique label combination.
const labels = { route: 20, status: 5, region: 6, customer_id: 1000000 };
const SERIES_BYTES = 3072; // about 3 KB of memory per active series
function series(names) { return names.reduce((p, n) => p * labels[n], 1); }
for (const names of [['route', 'status'], ['route', 'status', 'region'], ['route', 'status', 'region', 'customer_id']]) {
  const s = series(names);
  console.log(`labels ${names.join('+')}: ${s} series, ${(s * SERIES_BYTES / 1e9).toFixed(2)} GB`);
}
if (series(['route', 'status', 'region']) !== 600) throw new Error('cardinality is the product');
console.log('ok');
