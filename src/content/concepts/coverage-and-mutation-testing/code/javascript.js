// Coverage and Mutation Testing: four test suites for one small discount function, measured two ways.
// Look for: line coverage says 100% for a suite that asserts nothing, while the mutation score (mutants killed) tells the truth.
// A "mutant" is the function with one small change (a > turned into >=, a + into -). A suite KILLS a mutant if some test fails on it.
// Mutant 6 is an equivalent mutant: it changes the code but not the behaviour, so no test can ever kill it.
function discount(total, member, coupon, m, hit) { // m = number of the mutant to switch on, 0 for the real code
  hit(1); let rate = 0;
  hit(2); if (m === 1 ? total > 100 : total >= 100) { hit(3); rate = m === 2 ? 0 : 10; }
  hit(4); if (m === 3 ? !member : member) { hit(5); rate += m === 4 ? -5 : 5; }
  hit(6); if (coupon === 'SAVE5') { hit(7); rate += m === 5 ? 6 : 5; } else if (coupon === 'SAVE10') { hit(8); rate += m === 10 ? 9 : 10; }
  hit(9); if (m === 6 ? rate >= 20 : rate > 20) { hit(10); rate = m === 7 ? 25 : 20; }
  hit(11); const off = m === 8 ? Math.ceil(total * rate / 100) : Math.floor(total * rate / 100);
  hit(12); return m === 9 ? total + off : total - off;
}
const LINES = 12;
const MUTANTS = [ // [what changed, operator family]
  ['>= turned into >', 'condition'], ['base rate 10 turned into 0', 'constant'], ['member test negated', 'condition'],
  ['member bonus + turned into -', 'arithmetic'], ['SAVE5 bonus 5 turned into 6', 'constant'], ['cap > turned into >=', 'condition'],
  ['cap value 20 turned into 25', 'constant'], ['floor turned into ceil', 'arithmetic'], ['minus turned into plus', 'arithmetic'],
  ['SAVE10 bonus 10 turned into 9', 'constant'],
];

function seeded(seed) { // MINSTD generator: integers only, the product fits in 53 bits
  let s = seed;
  return (n) => { s = (s * 48271) % 2147483647; return s % n; };
}
function reference(total, member, coupon) { // an independent way to compute the answer, for the generated suite
  let pct = (total >= 100 ? 10 : 0) + (member ? 5 : 0) + (coupon === 'SAVE5' ? 5 : coupon === 'SAVE10' ? 10 : 0);
  if (pct > 20) pct = 20;
  return total - Math.floor(total * pct / 100);
}
// a test is [total, member, coupon, expected]; expected null means the test calls the code and asserts nothing
const SMOKE = [[150, true, 'SAVE10', null], [50, false, '', null], [100, false, 'SAVE5', null]];
const HAPPY = [[150, true, 'SAVE10', 120], [50, false, '', 50], [100, false, 'SAVE5', 85]];
const EDGES = [[100, false, '', 90], [99, false, '', 99], [101, false, '', 91], [200, true, 'SAVE10', 160], [100, true, 'SAVE5', 80], [50, true, '', 48], [120, false, 'SAVE10', 96]];
const gen = seeded(5), COUPONS = ['', 'SAVE5', 'SAVE10'], GENERATED = [];
for (let i = 0; i < 60; i++) { const t = 95 + gen(11), mem = gen(2) === 1, c = COUPONS[gen(3)]; GENERATED.push([t, mem, c, reference(t, mem, c)]); }
const SUITES = [['Smoke: runs the code, asserts nothing', SMOKE], ['Happy path: one assertion each', HAPPY], ['Edges and combinations', EDGES], ['60 generated inputs against a reference', GENERATED]];

function passes(tests, m) { return tests.every(([t, mem, c, want]) => want === null || discount(t, mem, c, m, () => {}) === want); }
function coverage(tests) { const seen = new Set(); tests.forEach(([t, mem, c]) => discount(t, mem, c, 0, (l) => seen.add(l))); return seen.size; }

for (const [name, tests] of SUITES) {
  const asserts = tests.filter((t) => t[3] !== null).length, lines = coverage(tests);
  const killed = MUTANTS.map((_, i) => !passes(tests, i + 1));
  const k = killed.filter(Boolean).length;
  console.log(`${name}: ${tests.length} tests, ${asserts} assertions, passes ${passes(tests, 0)}`);
  console.log(`  line coverage ${lines}/${LINES} = ${Math.floor(100 * lines / LINES)}%, mutants killed ${k}/${MUTANTS.length} = ${Math.floor(100 * k / MUTANTS.length)}%, mutation run cost ${tests.length * (MUTANTS.length + 1)}`);
  console.log(`  survivors: ${MUTANTS.filter((_, i) => !killed[i]).map((m) => m[0]).join('; ') || 'none'}`);
}
