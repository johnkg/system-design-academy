// An order state machine and a courier dispatcher, in JavaScript:
// every order change is checked against a table of legal moves and the version the caller saw,
// and a window of orders is assigned to couriers by cost instead of nearest-first.

const LEGAL = {
  placed: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['picked_up', 'cancelled'],
  picked_up: ['delivered'],
  delivered: [],
  cancelled: [],
};

class Order {
  constructor(id) { this.id = id; this.state = 'placed'; this.version = 1; this.log = ['placed']; this.seen = new Map(); }
  // The caller names the version it saw and a request id. Only the first matching request wins; a repeat gets the old answer.
  move(to, expectedVersion, requestId) {
    if (this.seen.has(requestId)) return this.seen.get(requestId) + ' (repeat)';
    let result;
    if (expectedVersion !== this.version) result = 'stale';
    else if (!LEGAL[this.state].includes(to)) result = 'illegal';
    else { this.state = to; this.version++; this.log.push(to); result = 'ok'; }
    this.seen.set(requestId, result);
    return result;
  }
}

const order = new Order('o-4471');
const calls = [
  ['accepted', 1, 'r1'], ['cancelled', 1, 'r2'],   // the cancel saw version 1, but the accept already made it version 2
  ['preparing', 2, 'r3'], ['delivered', 3, 'r4'],  // delivered cannot follow preparing
  ['picked_up', 3, 'r5'], ['delivered', 4, 'r6'], ['delivered', 4, 'r6'], // the last one is a repeated tap
  ['preparing', 5, 'r7'],                           // nothing can follow delivered
];
for (const [to, v, r] of calls) console.log(`${to} (saw v${v}, ${r}): ${order.move(to, v, r)}`);
console.log(`final: ${order.state} v${order.version}, log: ${order.log.join(' > ')}`);
if (order.version !== order.log.length || order.state !== 'delivered') process.exit(1);

// Dispatch: orders have a restaurant on a grid and a ready time; couriers have a position. One cell takes one minute.
let seed = 42;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const detail = (c, o) => { const t = dist(c, o.rest); return { travel: t, food: Math.max(0, t - o.ready), idle: Math.max(0, o.ready - t) }; };
const cost = (c, o) => { const d = detail(c, o); return 2 * d.food + d.idle + d.travel; }; // cold food counts double

function nearestFirst(orders, couriers) { // each order in turn takes the closest courier that is left
  const free = new Set(couriers.keys()); const pick = [];
  for (const o of orders) { let best = -1; for (const j of free) if (best < 0 || dist(couriers[j], o.rest) < dist(couriers[best], o.rest)) best = j; free.delete(best); pick.push(best); }
  return pick;
}
function bestAssignment(orders, couriers) { // try every way of pairing, which is fine for a small window (the real thing uses the Hungarian algorithm)
  let best = null; const used = new Set(); const cur = [];
  const go = (i, sum) => {
    if (best && sum >= best.sum) return;
    if (i === orders.length) { best = { sum, pick: [...cur] }; return; }
    for (let j = 0; j < couriers.length; j++) if (!used.has(j)) { used.add(j); cur.push(j); go(i + 1, sum + cost(couriers[j], orders[i])); cur.pop(); used.delete(j); }
  };
  go(0, 0);
  return best.pick;
}
const totals = (orders, couriers, pick) => pick.reduce((t, j, i) => { const d = detail(couriers[j], orders[i]); return { travel: t.travel + d.travel, food: t.food + d.food, idle: t.idle + d.idle, cost: t.cost + cost(couriers[j], orders[i]) }; }, { travel: 0, food: 0, idle: 0, cost: 0 });

const sum = { nearest: { travel: 0, food: 0, idle: 0, cost: 0 }, window: { travel: 0, food: 0, idle: 0, cost: 0 } };
let strictlyBetter = 0;
for (let trial = 0; trial < 200; trial++) { // 200 windows of 6 orders and 6 couriers
  const orders = Array.from({ length: 6 }, () => ({ rest: { x: rnd(20), y: rnd(20) }, ready: 4 + rnd(12) }));
  const couriers = Array.from({ length: 6 }, () => ({ x: rnd(20), y: rnd(20) }));
  const a = totals(orders, couriers, nearestFirst(orders, couriers)), b = totals(orders, couriers, bestAssignment(orders, couriers));
  if (b.cost > a.cost) process.exit(1); // the best assignment can never be worse
  if (b.cost < a.cost) strictlyBetter++;
  for (const k of Object.keys(a)) { sum.nearest[k] += a[k]; sum.window[k] += b[k]; }
}
for (const [name, s] of Object.entries(sum)) console.log(`${name.padEnd(8)} travel ${s.travel} min, food waiting ${s.food} min, courier waiting ${s.idle} min, cost ${s.cost}`);
console.log(`the window assignment was strictly cheaper in ${strictlyBetter} of 200 windows`);
if (sum.window.cost >= sum.nearest.cost) process.exit(1);
