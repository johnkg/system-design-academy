// Single Responsibility Principle: the same payroll report built three ways, hit by the same five change requests.
// Look for: how many classes each request touches, and how much unrelated behaviour (and which other teams' code) sits inside them.
// A design is a list of classes: [name, what it does (each item is a "reason to change"), which classes it calls].
const ACTOR = { overtime: 'finance', tax: 'finance', bonus: 'finance', format: 'operations', storage: 'IT', flow: '' };

const DESIGNS = [
  { name: 'One class does everything', classes: [
    ['Cli', [], ['PayrollReport']],
    ['PayrollReport', ['overtime', 'tax', 'bonus', 'format', 'storage', 'flow'], []],
  ] },
  { name: 'Split by reason to change', classes: [
    ['Cli', [], ['PayrollReport']],
    ['PayrollReport', ['flow'], ['PayCalculator', 'ReportFormatter', 'ReportStore']],
    ['PayCalculator', ['overtime', 'tax', 'bonus'], []],
    ['ReportFormatter', ['format'], []],
    ['ReportStore', ['storage'], []],
  ] },
  { name: 'Over-split: a class per step', classes: [
    ['Cli', [], ['ReportRunner']],
    ['ReportRunner', ['flow'], ['OvertimeCalculator', 'TaxCalculator', 'BonusCalculator', 'HeaderFormatter', 'RowFormatter', 'FileWriter']],
    ['OvertimeCalculator', ['overtime'], ['OvertimeRule', 'OvertimeRateTable']],
    ['OvertimeRule', ['overtime'], []],
    ['OvertimeRateTable', ['overtime'], []],
    ['TaxCalculator', ['tax'], ['TaxRule', 'TaxBracketTable']],
    ['TaxRule', ['tax'], []],
    ['TaxBracketTable', ['tax'], []],
    ['BonusCalculator', ['bonus'], ['BonusRule']],
    ['BonusRule', ['bonus'], []],
    ['HeaderFormatter', ['format'], ['ColumnLayout']],
    ['RowFormatter', ['format'], ['ColumnLayout']],
    ['ColumnLayout', ['format'], []],
    ['FileWriter', ['storage'], ['FilePathResolver', 'Serializer']],
    ['FilePathResolver', ['storage'], []],
    ['Serializer', ['storage'], []],
  ] },
];

const REQUESTS = [
  { text: 'tax rule changes', touches: ['tax'] },
  { text: 'new output format', touches: ['format'] },
  { text: 'new storage', touches: ['storage'] },
  { text: 'overtime rule changes', touches: ['overtime'] },
  { text: 'add a bonus column', touches: ['bonus', 'format'] },
];

function depth(classes, name) {
  const c = classes.find((x) => x[0] === name);
  let best = 0;
  for (const u of c[2]) best = Math.max(best, depth(classes, u));
  return best + 1;
}

function analyse(classes, req) {
  const touched = classes.filter((c) => c[1].some((r) => req.touches.includes(r)));
  const retest = new Set(touched.map((c) => c[0]));
  let grew = true;
  while (grew) { // anything that calls a retested class must be retested too
    grew = false;
    for (const c of classes) if (!retest.has(c[0]) && c[2].some((u) => retest.has(u))) { retest.add(c[0]); grew = true; }
  }
  let reverified = 0, bystanders = 0;
  const teams = new Set();
  for (const c of classes) if (retest.has(c[0])) reverified += c[1].length;
  for (const c of touched) for (const r of c[1]) if (!req.touches.includes(r)) {
    bystanders++;
    if (ACTOR[r] && !req.touches.some((t) => ACTOR[t] === ACTOR[r])) teams.add(ACTOR[r]);
  }
  return { touched: touched.map((c) => c[0]), retest: retest.size, reverified, bystanders, teams: teams.size };
}

for (const d of DESIGNS) {
  console.log(`== ${d.name}`);
  console.log(`  ${d.classes.length} classes to read to follow one report run, the longest call chain ${depth(d.classes, 'Cli')} deep`);
  let t = 0, r = 0, b = 0, o = 0;
  REQUESTS.forEach((req, i) => {
    const a = analyse(d.classes, req);
    console.log(`  R${i + 1} ${req.text}: edit ${a.touched.length} (${a.touched.join(', ')}); retest ${a.retest}; re-verify ${a.reverified} behaviours; bystander behaviours ${a.bystanders}; other teams at risk ${a.teams}`);
    t += a.touched.length; r += a.retest; b += a.bystanders; o += a.teams;
  });
  console.log(`  five requests: ${t} classes edited, ${r} retests, ${b} bystander behaviours, ${o} other-team exposures`);
}
