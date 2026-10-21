// Paired comparison of an old and a new model on the same seeded eval set, with a normal-approximation CI,
// a bootstrap CI and a release gate. Everything is integer arithmetic except the final square root.
const EVAL_SEED = 20240601, BOOTSTRAP_SEED = 7;
const DIFFICULTY_RANGE = 1000; // item difficulty z is 0..999
const NOISE = 150; // run-to-run noise is -150..+150
const PASS_BELOW = 700; // a model passes an item when z + noise is under this (about 70% accuracy)
const DIFFICULTY_PER_PT = DIFFICULTY_RANGE / 100; // one accuracy point moves the threshold by 10
const RESAMPLES = 1000, TAIL = RESAMPLES / 40; // bootstrap resamples, 2.5% of them in each tail
const Z95 = 1.96; // two-sided 95% normal quantile
const NON_INFERIORITY = 0.02; // ship unless the new model may be more than 2 points worse
const SMALL_N = 100, LARGE_N = 1000, GAIN_PTS = 3;

function lcg(seed) { let x = seed; return () => (x = (x * 48271) % 2147483647); }

// Item i is hard or easy (z). Each model passes when z plus its own run-to-run noise is under a threshold.
function evalSet(n, deltaPts) {
  const r = lcg(EVAL_SEED);
  const d = []; let passOld = 0, passNew = 0;
  for (let i = 0; i < n; i++) {
    const z = r() % DIFFICULTY_RANGE, noiseOld = (r() % (2 * NOISE + 1)) - NOISE, noiseNew = (r() % (2 * NOISE + 1)) - NOISE;
    const o = z + noiseOld < PASS_BELOW ? 1 : 0;
    const w = z + noiseNew < PASS_BELOW + deltaPts * DIFFICULTY_PER_PT ? 1 : 0;
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
  const r = lcg(BOOTSTRAP_SEED), sums = [];
  for (let b = 0; b < RESAMPLES; b++) { let t = 0; for (let k = 0; k < n; k++) t += s.d[r() % n]; sums.push(t); }
  sums.sort((a, b) => a - b);
  const lo = mean - Z95 * se, hi = mean + Z95 * se;
  const bLo = sums[TAIL] / n, bHi = sums[RESAMPLES - TAIL - 1] / n;                        // 2.5th and 97.5th percentile of 1000 resamples
  const gate = lo > -NON_INFERIORITY ? 'ship' : 'block';                           // non-inferiority: lower bound not below -2 points
  const label = lo > 0 ? 'better' : hi < 0 ? 'worse' : 'inconclusive';
  console.log(`n=${String(n).padStart(4)} change=${deltaPts >= 0 ? '+' : ''}${deltaPts} old=${fmt(p1)}% new=${fmt(p2)}% diff=${fmt(mean)}`);
  console.log(`  normal CI ${fmt(lo)}..${fmt(hi)}  bootstrap CI ${fmt(bLo)}..${fmt(bHi)}  paired width ${fmt(hi - lo)} vs unpaired ${fmt(2 * Z95 * seUnpaired)}`);
  console.log(`  verdict: ${label}, gate: ${gate}`);
  if (!(lo <= mean && mean <= hi && bLo <= mean && mean <= bHi)) throw new Error('mean outside its own interval');
  if (!(hi - lo < 2 * Z95 * seUnpaired)) throw new Error('pairing should narrow the interval');
  return { width: hi - lo, gate };
}

const small = compare(SMALL_N, GAIN_PTS), large = compare(LARGE_N, GAIN_PTS);
compare(LARGE_N, -GAIN_PTS);
compare(200, 0);
if (!(large.width < small.width)) throw new Error('more items must narrow the interval');
console.log(`gate at n=100: ${small.gate}, at n=1000: ${large.gate}`);
