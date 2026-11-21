// Stable dependencies and package design: the same product split into packages three ways. Each design is DATA: packages
// (with an assumed number of changes per quarter) and "A depends on B" edges. Everything printed is computed from it.
// Terms: Ca is how many packages depend on a package (afferent), Ce is how many it depends on (efferent).
// Instability I = Ce * 100 / (Ca + Ce), rounded down: 0 is maximally stable (others depend on it, it depends on
// nothing), 100 is maximally unstable. The Stable Dependencies Principle: depend in the direction of stability, so an
// edge from A to B is a violation when B is less stable than A. Acyclic Dependencies: no package can reach itself.
// Look for: the cycle among orders, billing, customers and utils, what one change to utils rebuilds, and what splitting
// every class into its own package costs when a feature crosses layers.
const D = (changes, edges, feature) => ({ changes, edges: edges.map((e) => e.split('>')), feature });
const DESIGNS = [
  { name: 'Tangled: a utils package and a cycle', ...D(
    { web: 10, orders: 8, billing: 6, customers: 5, notifications: 3, reports: 4, utils: 12 },
    ['web>orders', 'web>billing', 'web>reports', 'web>notifications', 'orders>billing', 'billing>customers', 'customers>orders', 'orders>utils',
     'billing>utils', 'customers>utils', 'notifications>utils', 'notifications>customers', 'reports>orders', 'reports>utils', 'utils>customers'],
    ['customers', 'billing', 'web']),
    roles: { helper: 'utils', customerRules: 'customers', orderRules: 'orders', customerContract: 'customers' } },
  { name: 'Layered: acyclic, small stable bases', ...D(
    { web: 10, orders: 8, billing: 6, customers: 5, notifications: 3, reports: 4, money: 1, text: 2 },
    ['web>orders', 'web>billing', 'web>reports', 'web>notifications', 'orders>billing', 'orders>customers', 'billing>customers', 'billing>money',
     'reports>orders', 'reports>text', 'notifications>customers', 'notifications>text', 'customers>money'],
    ['customers', 'billing', 'web']),
    roles: { helper: 'money', customerRules: 'customers', orderRules: 'orders', customerContract: 'customers' } },
  { name: 'Over-split: an api and an impl package for everything', ...D(
    { web: 10, 'orders-api': 1, 'orders-impl': 8, 'billing-api': 1, 'billing-impl': 6, 'customers-api': 1, 'customers-impl': 5,
      'notifications-api': 1, 'notifications-impl': 3, reports: 4, money: 1, text: 2, app: 3 },
    ['web>orders-api', 'web>billing-api', 'web>reports', 'web>notifications-api', 'orders-impl>orders-api', 'orders-impl>billing-api',
     'orders-impl>customers-api', 'billing-impl>billing-api', 'billing-impl>customers-api', 'billing-impl>money', 'customers-impl>customers-api',
     'customers-impl>money', 'notifications-impl>notifications-api', 'notifications-impl>customers-api', 'notifications-impl>text',
     'reports>orders-api', 'reports>text', 'app>web', 'app>orders-impl', 'app>billing-impl', 'app>customers-impl', 'app>notifications-impl'],
    ['customers-api', 'customers-impl', 'billing-api', 'billing-impl', 'web']),
    roles: { helper: 'money', customerRules: 'customers-impl', orderRules: 'orders-impl', customerContract: 'customers-api' } },
];
const CHANGES = [['helper', 'the shared helper package'], ['customerRules', 'customer rules'], ['orderRules', 'order rules'], ['customerContract', 'the customer contract']];

// Packages reachable from `start` by following edges forward (breadth-first); `start` itself only if a cycle returns to it.
function reach(edges, start) {
  const seen = new Set(), queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const [a, b] of edges) if (a === cur && !seen.has(b)) { seen.add(b); queue.push(b); }
  }
  return seen;
}
// A change to p forces a rebuild and retest of p and of every package that depends on it, directly or not.
function rebuildSet(d, p) {
  const out = new Set([p]);
  for (const q of Object.keys(d.changes)) if (reach(d.edges, q).has(p)) out.add(q);
  return out;
}
const inCycle = (d) => Object.keys(d.changes).filter((p) => reach(d.edges, p).has(p));
const instability = (d, p) => {
  const ce = d.edges.filter((e) => e[0] === p).length, ca = d.edges.filter((e) => e[1] === p).length;
  return ca + ce === 0 ? 0 : Math.floor((ce * 100) / (ca + ce));
};
const violations = (d) => d.edges.filter(([a, b]) => instability(d, b) > instability(d, a));
// Package builds per quarter: every change to a package rebuilds its whole rebuild set.
const buildsPerQuarter = (d) => Object.keys(d.changes).reduce((sum, p) => sum + d.changes[p] * rebuildSet(d, p).size, 0);

for (const d of DESIGNS) {
  const all = Object.keys(d.changes);
  const cyc = inCycle(d);
  console.log(`== ${d.name}`);
  console.log(`  packages: ${all.length}; dependency edges: ${d.edges.length}; packages in a cycle (must be released together): ${cyc.length}; edges that depend on something less stable: ${violations(d).length}`);
  console.log(`  package builds per quarter, from the assumed change counts: ${buildsPerQuarter(d)}; packages edited by a feature that adds one customer field to the web page: ${d.feature.length}`);
  for (const [key, label] of CHANGES) {
    const p = d.roles[key];
    console.log(`  a change to ${label} (${p}, instability ${instability(d, p)}) rebuilds and retests ${rebuildSet(d, p).size} of ${all.length} packages`);
  }
}
