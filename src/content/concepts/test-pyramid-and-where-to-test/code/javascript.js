// Test Pyramid and Where to Test: one app with 8 known bugs, tested by suites with a different mix of test kinds.
// Look for: which bugs each mix catches, what it costs to run, and how often a run goes red for no reason.
// Model: tests of one kind are ordered by value, so the n-th test of a kind reaches the n-th area it can see.
// need = [unit, integration, e2e]: how many tests of that kind are needed to reach the bug (0 = that kind cannot see it).
const KINDS = ['unit', 'integration', 'e2e'];
const COST = [1, 20, 150];   // assumed cost units to run one test of each kind
const FLAKE = [0, 10, 50];   // assumed chance in 1000 that one test fails on its own in one run
const RUNS = 50;
const BUGS = [
  ['Percentage discount rounds down', [1, 3, 8]],
  ['Tax wrong at the exact threshold', [2, 5, 0]],
  ['Coupons stack in the wrong order', [3, 6, 10]],
  ['Order saved with swapped columns', [0, 1, 4]],
  ['API sends cents where dollars expected', [0, 2, 5]],
  ['Payment timeout set too short', [0, 3, 0]],
  ['Pay button wired to the wrong handler', [0, 0, 1]],
  ['Session lost after login redirect', [0, 0, 2]],
];
const SUITES = [
  ['Pyramid', [60, 12, 3]],
  ['Trophy', [20, 30, 5]],
  ['Ice-cream cone', [5, 5, 60]],
  ['Unit tests only', [200, 0, 0]],
  ['End-to-end only', [0, 0, 60]],
];

function seeded(seed) {            // MINSTD generator: integers only, the product fits in 53 bits
  let s = seed;
  return (n) => { s = (s * 48271) % 2147483647; return s % n; };
}

function evaluate(counts) {
  const found = BUGS.map(([, need]) => KINDS.findIndex((k, i) => need[i] > 0 && counts[i] >= need[i]));
  const cost = counts.reduce((sum, n, i) => sum + n * COST[i], 0);
  const rand = seeded(42);
  let red = 0;
  for (let r = 0; r < RUNS; r++) {
    let flaked = false;
    counts.forEach((n, i) => { for (let t = 0; t < n; t++) if (rand(1000) < FLAKE[i]) flaked = true; });
    if (flaked) red++;
  }
  return { found, cost, red };
}

for (const [name, counts] of SUITES) {
  const { found, cost, red } = evaluate(counts);
  const caught = found.filter((f) => f >= 0).length;
  console.log(`${name} (${counts.join('/')}): caught ${caught}/${BUGS.length}, cost ${cost}, red runs ${red}/${RUNS}`);
  const missed = BUGS.filter((_, i) => found[i] < 0).map(([n]) => n);
  console.log(`  escaped: ${missed.length ? missed.join('; ') : 'none'}`);
}
const pyramid = evaluate(SUITES[0][1]);
BUGS.forEach(([n], i) => console.log(`Pyramid found "${n}" via ${KINDS[pyramid.found[i]]} tests`));
