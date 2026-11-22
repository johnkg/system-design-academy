// Blast radius of one compromised host in 12 services, under four network policies. Toy model: integers and fixed data only.
// Assumption (worst case, stated): every host the attacker can open a connection to can be taken over in turn.
const HOSTS = ['web', 'bff', 'orders', 'payments', 'inventory', 'search', 'users', 'orders-db', 'users-db', 'cache', 'ci', 'monitor'];
const ZONE = { web: 'edge', bff: 'edge', orders: 'app', payments: 'app', inventory: 'app', search: 'app', users: 'app', 'orders-db': 'data', 'users-db': 'data', cache: 'data', ci: 'ops', monitor: 'ops' };
const JEWELS = ['orders-db', 'users-db', 'payments'];
// The calls the system really needs: [caller, callee, approved]. The last four were added since the last policy review (approved = false).
const FLOWS = [
  ['web', 'orders', 1], ['web', 'search', 1], ['web', 'users', 1], ['bff', 'orders', 1], ['bff', 'users', 0],
  ['orders', 'payments', 1], ['orders', 'inventory', 1], ['orders', 'orders-db', 1], ['orders', 'cache', 1],
  ['users', 'users-db', 1], ['users', 'cache', 1], ['search', 'cache', 0],
  ['ci', 'web', 1], ['ci', 'orders', 1], ['ci', 'users', 0],
  ...['web', 'bff', 'orders', 'payments', 'inventory', 'users', 'cache'].map((h) => ['monitor', h, 1]), ['monitor', 'search', 0],
];
// Segmentation: which zone may open connections to which. Inside a zone every host can talk to every other.
const ZONE_RULES = { edge: ['edge', 'app'], app: ['app', 'data'], data: ['data'], ops: ['ops', 'edge', 'app', 'data'] };

function allowed(variant, exceptions) {
  const set = new Set();
  for (const a of HOSTS) for (const b of HOSTS) {
    if (a === b) continue;
    if (variant === 'flat' || (variant === 'segmented' && ZONE_RULES[ZONE[a]].includes(ZONE[b]))) set.add(a + '>' + b);
  }
  if (variant === 'identity' || variant === 'strict') {
    for (const [a, b, ok] of FLOWS) {
      if (variant === 'identity' || ok) set.add(a + '>' + b);
      // The "exception" people grant to unblock a broken flow in a hurry: caller may reach the callee's whole zone.
      else if (exceptions) for (const c of HOSTS) if (ZONE[c] === ZONE[b] && c !== a) set.add(a + '>' + c);
    }
  }
  return set;
}
function reach(edges, start) {
  const seen = new Set([start]); const queue = [start];
  while (queue.length) { const a = queue.shift(); for (const b of HOSTS) if (edges.has(a + '>' + b) && !seen.has(b)) { seen.add(b); queue.push(b); } }
  seen.delete(start); return seen;
}

function report(name, variant, exceptions) {
  const edges = allowed(variant, exceptions);
  const working = FLOWS.filter(([a, b]) => edges.has(a + '>' + b)).length;
  console.log(`-- ${name}`);
  console.log(`  allowed connections ${edges.size} of 132; needed flows working ${working} of ${FLOWS.length}; connections nobody needs ${edges.size - working}`);
  for (const h of ['web', 'search', 'ci']) {
    const r = reach(edges, h); const direct = HOSTS.filter((b) => edges.has(h + '>' + b)).length;
    console.log(`  ${h} compromised: direct connections ${direct}; hosts reached by pivoting ${r.size}; crown jewels reached ${JEWELS.filter((j) => r.has(j)).length} of ${JEWELS.length}`);
  }
  let total = 0; for (const h of HOSTS) total += reach(edges, h).size;
  console.log(`  summed over each of the 12 hosts as the entry point: ${total} of 132 host takeovers possible`);
}
report('flat network: everything reaches everything', 'flat', false);
report('segmented: zones edge, app, data, ops', 'segmented', false);
report('identity-based: mTLS, each service lists who may call it', 'identity', false);
report('over-applied: only reviewed flows allowed, no exceptions', 'strict', false);
report('over-applied, then broad exceptions granted to unblock', 'strict', true);
console.log('-- search tries to call orders-db directly');
for (const v of ['flat', 'segmented', 'identity']) console.log(`  ${v}: ${allowed(v, false).has('search>orders-db') ? 'allowed' : 'denied'}`);
