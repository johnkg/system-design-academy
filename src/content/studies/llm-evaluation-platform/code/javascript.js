// A paired comparison of two prompt versions with a bootstrap confidence interval and a CI gate, in JavaScript:
// the same 400 test cases are graded for both versions, and the gate looks at the interval of the difference, not at the two pass rates alone.

const SEED = 2026;
const HARDNESS_RANGE = 1000, BASE_PASS_BELOW = 700, CAND_PASS_BELOW = 730, NOISE = 100; // the candidate shifts each case by -100..+99
const RESAMPLES = 1000, TAIL = RESAMPLES / 40; // bootstrap resamples, 2.5% of them in each tail
const LABELED = 150, JUDGE_ACCURACY = 88, MIN_AGREE = 120; // the judge matches a human 88% of the time
const REGRESSION_BUDGET = 200; // 2 points, in hundredths
let seed = SEED;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Hundredths of a percentage point as text, using integers only (so every language prints the same).
const pp = (h) => `${h < 0 ? '-' : '+'}${Math.floor(Math.abs(h) / 100)}.${String(Math.abs(h) % 100).padStart(2, '0')}`;

const N = 400;
const HUNDREDTHS_PER_CASE = 10000 / N; // sum / N * 100 percent * 100 hundredths
const base = [], cand = [];
for (let i = 0; i < N; i++) {
  const hardness = rnd(HARDNESS_RANGE);                             // a hard case is hard for both versions
  base.push(hardness < BASE_PASS_BELOW ? 1 : 0);
  cand.push(hardness + rnd(2 * NOISE) - NOISE < CAND_PASS_BELOW ? 1 : 0);      // the new version is a little better on average
}
const diff = base.map((b, i) => cand[i] - b);               // +1 fixed, -1 broken, 0 same
const count = (a, v) => a.filter((x) => x === v).length;
console.log(`base ${count(base, 1)}/${N}, candidate ${count(cand, 1)}/${N}, fixed ${count(diff, 1)}, broken ${count(diff, -1)}`);

// Bootstrap: resample the cases with replacement 1000 times and take the 2.5th and 97.5th percentile.
function interval(draw) {
  const sums = [];
  for (let r = 0; r < RESAMPLES; r++) {
    let s = 0;
    for (let k = 0; k < N; k++) s += draw();
    sums.push(s);
  }
  sums.sort((a, b) => a - b);
  return [sums[TAIL] * HUNDREDTHS_PER_CASE, sums[RESAMPLES - TAIL - 1] * HUNDREDTHS_PER_CASE];
}
const [pLo, pHi] = interval(() => diff[rnd(N)]);                                  // paired: one index, both versions
const [uLo, uHi] = interval(() => cand[rnd(N)] - base[rnd(N)]);                   // unpaired: independent indexes
console.log(`paired 95% interval for the change: ${pp(pLo)} to ${pp(pHi)} points`);
console.log(`unpaired interval would be:        ${pp(uLo)} to ${pp(uHi)} points`);

// Judge calibration: compare the LLM judge with human labels on 150 cases.
let agree = 0, judgePass = 0, humanPass = 0;
for (let i = 0; i < LABELED; i++) {
  const human = cand[i], judge = rnd(100) < JUDGE_ACCURACY ? human : 1 - human;
  agree += human === judge ? 1 : 0; judgePass += judge; humanPass += human;
}
console.log(`judge agrees with humans on ${agree}/150, judge passes ${judgePass}, humans pass ${humanPass}`);

// Gate: block if the lower end of the interval is worse than a 2 point regression budget.
const gate = pLo > -REGRESSION_BUDGET ? 'ship' : 'block';
const proven = pLo > 0 ? 'improvement proven' : 'improvement not proven';
console.log(`gate: ${gate} (${proven})`);
if (!(pHi - pLo < uHi - uLo) || agree < MIN_AGREE || gate !== 'ship') process.exit(1);
