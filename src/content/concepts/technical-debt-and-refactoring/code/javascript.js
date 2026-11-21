// Technical debt and refactoring: a team with 40 points of work per sprint, in code that carries 30 points of debt.
// Debt is the interest rate: in code the team changes every sprint ("hot" code), each feature costs 10 points plus one
// extra point for every 10 points of debt, and each rushed feature adds 2 more points of debt.
// Look for: how features delivered change with the strategy, what refactoring without tests costs, how a rewrite
// that takes longer than planned never catches up, and why debt in code nobody touches costs nothing.
// Assumptions of the toy: a refactoring step costs 8 points and removes 6 points of debt. Without tests, every third
// sprint's refactoring causes a regression that costs 12 points to find and fix. A rewrite delivers no features
// while it runs, then starts with 5 points of debt. A feature that does not fit in what is left of a sprint waits.
const CAP = 40, START_DEBT = 30, NEW_DEBT = 2, REFACTOR_COST = 8, REFACTOR_GAIN = 6, REGRESSION_COST = 12, REWRITE_DEBT = 5, BASE_COST = 10;
const STRATEGIES = [
  { name: 'Ignore the debt', kind: 'ignore', rewrite: 0 },
  { name: 'Small steps every sprint', kind: 'small', rewrite: 0 },
  { name: 'Rewrite, 3 sprints', kind: 'rewrite', rewrite: 3 },
  { name: 'Rewrite, 6 sprints', kind: 'rewrite', rewrite: 6 },
  { name: 'Rewrite, 12 sprints', kind: 'rewrite', rewrite: 12 },
];

function simulate(st, sprints, tests, hot) {
  let debt = START_DEBT, features = 0, regressions = 0;
  const cost = () => BASE_COST + (hot ? Math.floor(debt / 10) : 0);
  const cumulative = [];
  for (let s = 1; s <= sprints; s++) {
    let cap = CAP;
    if (st.kind === 'rewrite' && s <= st.rewrite) { cap = 0; if (s === st.rewrite) debt = REWRITE_DEBT; }
    if (st.kind === 'small') {
      cap -= REFACTOR_COST; debt = Math.max(0, debt - REFACTOR_GAIN);
      if (!tests && s % 3 === 0) { cap -= REGRESSION_COST; regressions++; }
    }
    while (cap >= cost()) { cap -= cost(); features++; debt += NEW_DEBT; }
    cumulative.push(features);
  }
  return { features, debt, cost: cost(), regressions, cumulative };
}

// First sprint from which a strategy stays ahead of ignoring the debt (checked over 60 sprints); -1 if it never does.
function overtakes(st, tests, hot) {
  const a = simulate(st, 60, tests, hot).cumulative, base = simulate(STRATEGIES[0], 60, tests, hot).cumulative;
  let from = -1;
  for (let i = 59; i >= 0; i--) { if (a[i] > base[i]) from = i + 1; else break; }
  return from;
}

for (const hot of [true, false]) {
  for (const tests of [true, false]) {
    console.log(`== debt in ${hot ? 'hot code (changed every sprint)' : 'cold code (nobody touches it)'}, ${tests ? 'with' : 'without'} tests around it`);
    for (let k = 0; k < STRATEGIES.length; k++) {
      const st = STRATEGIES[k];
      const cells = [6, 12, 24].map((n) => simulate(st, n, tests, hot).features);
      const r = simulate(st, 24, tests, hot);
      const o = k === 0 ? 'n/a' : overtakes(st, tests, hot) < 0 ? 'never' : `sprint ${overtakes(st, tests, hot)}`;
      console.log(`  ${st.name}: features after 6, 12, 24 sprints: ${cells.join(', ')}; at 24: debt ${r.debt}, one feature costs ${r.cost} points, regressions ${r.regressions}; stays ahead of ignoring from: ${o}`);
    }
  }
}
