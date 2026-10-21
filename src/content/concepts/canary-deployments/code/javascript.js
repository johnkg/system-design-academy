// Canary analysis: compare the canary's error rate with the stable version's, using integers only.
// Error rates are counts out of 10000 requests. Everything is seeded, so the output never changes.
const PER_MIN = 1000;   // requests per minute across the whole service
const STABLE = 100;     // the stable version fails 1.00% of requests
const RATE_SCALE = 10000;  // rates are counts out of this many requests
const PERCENT_TO_RATE = RATE_SCALE / 100;
const MIN_STABLE_RATE = 10; // 0.10%: the stable rate used is never below this
const ZT_PER_SIGMA = 10;    // zt is in tenths of a standard deviation
const FINAL_STAGE = 50;     // percent of traffic at the last canary stage
const WIDER_STAGES = [25, FINAL_STAGE];
const BASELINE_ERRORS = 1000, BASELINE_REQUESTS = 100000; // the 1.00% baseline of the gate demo
const THREE_SIGMA = 3 * ZT_PER_SIGMA;
const MIN_SAMPLE = 300;
const NEXT = (share) => WIDER_STAGES.filter((s) => s > share); // after the first share the canary widens to 25%, then 50%

function makeRng(seed) { // 32-bit LCG; the middle bits are random enough for a demo
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) % RATE_SCALE; };
}

// The health gate. zt is the threshold in tenths of a standard deviation (30 = 3.0 sigma).
// Is the canary's error count higher than the stable rate predicts, by more than zt/10 standard deviations?
//   expected errors = cn * p / 10000, variance ~ expected, so:  x^2 >= (zt/10)^2 * variance * 10000^2
function gate(ce, cn, be, bn, zt, minN) {
  if (cn === 0 || cn < minN) return 'hold';              // too little data to judge
  const p = Math.max(Math.floor((be * RATE_SCALE) / bn), MIN_STABLE_RATE);  // stable rate, never below 0.10%
  const x = ce * RATE_SCALE - cn * p;                          // errors above expectation, scaled by 10000
  return x > 0 && x * x >= zt * zt * cn * p * (RATE_SCALE / (ZT_PER_SIGMA * ZT_PER_SIGMA)) ? 'rollback' : 'pass';
}

function rollout(name, { share, bake, zt, minN, canaryRate, seed }) {
  const rnd = makeRng(seed);
  const stages = [share, ...NEXT(share)];
  let stage = 0, inStage = 0, ce = 0, cn = 0, be = 0, bn = 0, failed = 0, canaryFailed = 0, outcome = '';
  console.log(`-- ${name}: start ${share}%, bake ${bake} min, ${Math.floor(zt / 10)}.${zt % 10} sigma, min sample ${minN}`);
  for (let m = 1; outcome === ''; m++) {
    for (let i = 0; i < PER_MIN; i++) {
      const toCanary = rnd() < stages[stage] * PERCENT_TO_RATE;
      const err = rnd() < (toCanary ? canaryRate : STABLE);
      if (toCanary) { cn++; if (err) { ce++; canaryFailed++; } } else { bn++; if (err) be++; }
      if (err) failed++;
    }
    inStage++;
    const verdict = gate(ce, cn, be, bn, zt, minN);
    let action = verdict === 'pass' ? 'bake' : verdict;
    if (verdict === 'pass' && inStage >= bake) action = stage === stages.length - 1 ? 'promote to 100%' : 'widen';
    console.log(`m${m} ${stages[stage]}% canary ${ce}/${cn} stable ${be}/${bn} -> ${action}`);
    if (verdict === 'rollback') outcome = 'rolled back';
    else if (action === 'promote to 100%') outcome = 'promoted';
    else if (action === 'widen') { stage++; inStage = 0; ce = cn = be = bn = 0; }
  }
  const truth = canaryRate > STABLE ? 'buggy' : 'healthy';
  const verdict = outcome === 'promoted' ? (truth === 'buggy' ? 'MISSED BUG' : 'correct') : (truth === 'buggy' ? 'correct' : 'FALSE ALARM');
  console.log(`result: ${outcome}, v2 is ${truth} (${verdict}); failed ${failed}, by v2 ${canaryFailed}`);
  if (outcome === 'promoted' && stages[stage] !== FINAL_STAGE) throw new Error('promoted without passing the 50% stage');
  if (canaryFailed > failed) throw new Error('v2 cannot fail more requests than the whole service');
}

// The same gate on the same 1.00% baseline, judged on small and large canary samples.
for (const [ce, cn] of [[3, 100], [4, 100], [3, 300], [9, 300], [30, 1000]]) {
  console.log(`gate(${ce}/${cn} vs 1.00%, 3 sigma) = ${gate(ce, cn, BASELINE_ERRORS, BASELINE_REQUESTS, THREE_SIGMA, 0)}`);
}
if (gate(0, 0, 1, 100, THREE_SIGMA, 0) !== 'hold') throw new Error('no data must hold');
if (gate(5, 100, BASELINE_ERRORS, BASELINE_REQUESTS, THREE_SIGMA, MIN_SAMPLE) !== 'hold') throw new Error('small sample must hold');

rollout('default gate, v2 buggy', { share: 5, bake: 5, zt: THREE_SIGMA, minN: MIN_SAMPLE, canaryRate: 200, seed: 8 });
rollout('judge at once, v2 buggy', { share: 1, bake: 2, zt: THREE_SIGMA, minN: 0, canaryRate: 200, seed: 12 });
rollout('judge at once, v2 healthy', { share: 1, bake: 2, zt: 20, minN: 0, canaryRate: 100, seed: 7 });
