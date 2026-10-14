// A federation gateway's core in JavaScript: plan a query across subgraphs, batch the entity fetches,
// reject expensive queries, and accept only persisted queries by hash.

// The supergraph: which subgraph owns each field, and whether it returns a list. Lists are assumed to hold 10 items when costing.
const FIELDS = {
  users: { sub: 'users', list: true },
  friends: { sub: 'users', list: true },
  orders: { sub: 'orders', list: true },
  product: { sub: 'products', list: false },
  price: { sub: 'products', list: false },
};
const MAX_DEPTH = 5, MAX_COST = 500, LIST_GUESS = 10;

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return (seed >>> 16) % n; };

// Subgraph data, keyed by entity id. Each subgraph only knows its own part.
const users = Array.from({ length: 20 }, (_, id) => ({ id }));
const orders = [];
for (const u of users) for (let k = random(4); k > 0; k--) orders.push({ id: orders.length, userId: u.id, productId: random(8) });
const prices = Array.from({ length: 8 }, (_, id) => 10 + ((id * 37) % 90));

function makeSubgraphs(calls) {
  const hit = (name) => { calls[name] = (calls[name] || 0) + 1; };
  return {
    users: () => { hit('users'); return users.map((u) => u.id); },
    orders: (userIds) => { hit('orders'); return userIds.map((id) => orders.filter((o) => o.userId === id)); }, // one batch call, answers in key order
    products: (ids) => { hit('products'); return ids.map((id) => ({ id, price: prices[id] })); },
  };
}

// Run the chain users -> orders -> product -> price. With batch, each level makes one call; without it, one call per parent.
function execute(batch) {
  const calls = {}, sg = makeSubgraphs(calls);
  const userIds = sg.users();
  const fetchOrders = (ids) => (batch ? sg.orders(ids) : ids.map((id) => sg.orders([id])[0]));
  const perUser = fetchOrders(userIds);
  const all = perUser.flat();
  const keys = batch ? [...new Set(all.map((o) => o.productId))] : all.map((o) => o.productId);
  const found = batch ? sg.products(keys) : keys.map((k) => sg.products([k])[0]);
  const priceOf = new Map(found.map((p) => [p.id, p.price]));
  return { calls, total: all.reduce((sum, o) => sum + priceOf.get(o.productId), 0) };
}

// Analyse a query (a chain of field names) before running it: depth, and cost = number of objects it could touch.
function analyse(path) {
  let mult = 1, cost = 0;
  for (const f of path) { if (FIELDS[f].list) mult *= LIST_GUESS; cost += mult; }
  const verdict = path.length > MAX_DEPTH ? 'too deep' : cost > MAX_COST ? 'too costly' : 'ok';
  return { depth: path.length, cost, verdict };
}

const fnv1a = (text) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const hex = (h) => h.toString(16).padStart(8, '0');

const good = ['users', 'orders', 'product', 'price'];
const attack = ['users', 'friends', 'friends', 'friends', 'friends', 'friends'];
const wide = ['users', 'friends', 'friends', 'friends'];
const allowed = new Set([hex(fnv1a(good.join('.')))]); // the persisted-query registry, filled at deploy time
const gate = (hash) => (allowed.has(hash) ? 'allowed' : 'unknown hash, rejected');

const naive = execute(false), batched = execute(true);
console.log(`orders: ${orders.length} across ${users.length} users`);
console.log(`naive calls: ${JSON.stringify(naive.calls)}`);
console.log(`batched calls: ${JSON.stringify(batched.calls)}`);
console.log(`sum of prices: naive ${naive.total}, batched ${batched.total}`);
for (const [name, q] of [['good', good], ['wide', wide], ['attack', attack]]) {
  const a = analyse(q);
  console.log(`${name}: depth ${a.depth}, cost ${a.cost}, ${a.verdict}, hash ${hex(fnv1a(q.join('.')))} ${gate(hex(fnv1a(q.join('.'))))}`);
}
const sameResult = naive.total === batched.total;
const fewer = batched.calls.orders === 1 && batched.calls.products === 1 && naive.calls.orders === users.length;
console.log(`same result: ${sameResult}; batching holds: ${fewer}`);
if (!sameResult || !fewer || analyse(good).verdict !== 'ok' || analyse(attack).verdict === 'ok') process.exit(1);
