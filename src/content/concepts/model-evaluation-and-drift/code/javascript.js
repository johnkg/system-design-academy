// Paired comparison of an old and a new model on the same seeded eval set, with a normal-approximation CI,
// a bootstrap CI and a release gate. Everything is integer arithmetic except the final square root.
function lcg(seed) { let x = seed; return () => (x = (x * 48271) % 2147483647); }

// Item i is hard or easy (z). Each model passes when z plus its own run-to-run noise is under a threshold.
function evalSet(n, deltaPts) {
  const r = lcg(20240601);
  const d = []; let passOld = 0, passNew = 0;
  for (let i = 0; i < n; i++) {
    const z = r() % 1000, noiseOld = (r() % 301) - 150, noiseNew = (r() % 301) - 150;
    const o = z + noiseOld < 700 ? 1 : 0;
    const w = z + noiseNew < 700 + deltaPts * 10 ? 1 : 0;
    passOld += o; passNew += w; d.push(w - o); // per-item paired difference: -1, 0 or +1
  }
  return { n, d, passOld, passNew };
}

const fmt = (v) => { // fraction -> percentage points, 2 decimals, round half up, same in every language
  const x = v * 100, k = Math.floor(Math.abs(x) * 100 + 0.5);
  return (x < 0 && k > 0 ? '-' : '') + Math.floor(k / 100) + '.' + String(k % 100).padStart(2, '0');
};

function compare(n, deltaPts) {
  const s = evalSet(n, deltaPts);
  const sum = s.d.reduce((a, b) => a + b, 0), sumSq = s.d.reduce((a, b) => a + b * b, 0);
  const mean = sum / n;
  const se = Math.sqrt((sumSq - n * mean * mean) / (n - 1) / n);          // paired standard error
  const p1 = s.passOld / n, p2 = s.passNew / n;
  const seUnpaired = Math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / n);      // what you would get by ignoring the pairing
  const r = lcg(7), sums = [];
  for (let b = 0; b < 1000; b++) { let t = 0; for (let k = 0; k < n; k++) t += s.d[r() % n]; sums.push(t); }
  sums.sort((a, b) => a - b);
  const lo = mean - 1.96 * se, hi = mean + 1.96 * se;
  const bLo = sums[25] / n, bHi = sums[974] / n;                          // 2.5th and 97.5th percentile of 1000 resamples
  const gate = lo > -0.02 ? 'ship' : 'block';                             // non-inferiority: lower bound not below -2 points
  const label = lo > 0 ? 'better' : hi < 0 ? 'worse' : 'inconclusive';
  console.log(`n=${String(n).padStart(4)} change=${deltaPts >= 0 ? '+' : ''}${deltaPts} old=${fmt(p1)}% new=${fmt(p2)}% diff=${fmt(mean)}`);
  console.log(`  normal CI ${fmt(lo)}..${fmt(hi)}  bootstrap CI ${fmt(bLo)}..${fmt(bHi)}  paired width ${fmt(hi - lo)} vs unpaired ${fmt(2 * 1.96 * seUnpaired)}`);
  console.log(`  verdict: ${label}, gate: ${gate}`);
  if (!(lo <= mean && mean <= hi && bLo <= mean && mean <= bHi)) throw new Error('mean outside its own interval');
  if (!(hi - lo < 2 * 1.96 * seUnpaired)) throw new Error('pairing should narrow the interval');
  return { width: hi - lo, gate };
}

const small = compare(100, 3), large = compare(1000, 3);
compare(1000, -3);
compare(200, 0);
if (!(large.width < small.width)) throw new Error('more items must narrow the interval');
console.log(`gate at n=100: ${small.gate}, at n=1000: ${large.gate}`);
