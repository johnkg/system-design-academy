// A miniature of the ideas in Amazon's Dynamo paper (SOSP 2007), in JavaScript (a teaching model, not Amazon's code):
// a ring of nodes, N=3 replicas, R=2 and W=2, a sloppy quorum with hinted handoff, and vector clocks that keep
// concurrent shopping-cart updates as siblings until a reader merges them. Everything is deterministic.

const NODES = [['A', 10], ['B', 30], ['C', 50], ['D', 70], ['E', 90]]; // name and position on a ring of 100 points
const N = 3, R = 2, W = 2;
const down = new Set();
const store = Object.fromEntries(NODES.map(([name]) => [name, []])); // versions held by each node

const position = (key) => [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 100;
function walk(key) { // every node, clockwise from the key's position
  const start = Math.max(0, NODES.findIndex(([, pos]) => pos >= position(key)));
  return NODES.map((_, k) => NODES[(start + k) % NODES.length][0]);
}
const healthy = (key) => walk(key).filter((n) => !down.has(n));
const show = (clock) => Object.keys(clock).sort().map((k) => `${k}:${clock[k]}`).join(',');
const descends = (a, b) => Object.keys(b).every((k) => (a[k] ?? 0) >= b[k]);

function put(key, items, context, coordinator) {
  const clock = { ...context };
  const coord = coordinator ?? healthy(key)[0];
  clock[coord] = (clock[coord] ?? 0) + 1;
  const missing = walk(key).slice(0, N).filter((n) => down.has(n)); // owners that cannot take their copy
  const targets = healthy(key).slice(0, N);
  for (const t of targets) {
    const own = walk(key).slice(0, N).includes(t);
    const version = { key, clock, items, hintFor: own ? null : missing.shift() };
    store[t] = store[t].filter((v) => v.key !== key || !descends(clock, v.clock)).concat(version);
  }
  const hints = targets.filter((t) => !walk(key).slice(0, N).includes(t));
  console.log(`put ${key} ${items.join('+')} via ${coord} clock ${show(clock)}: ${targets.length} acks, ${targets.length >= W ? 'ok' : 'FAILED'}${hints.length ? `, hint kept on ${hints.join(',')}` : ''}`);
}

function get(key) {
  const seen = [];
  for (const n of healthy(key).slice(0, R)) for (const v of store[n]) if (v.key === key) seen.push(v);
  const kept = seen.filter((v, i) => !seen.some((o, j) => (descends(o.clock, v.clock) && show(o.clock) !== show(v.clock)) || (show(o.clock) === show(v.clock) && j < i)));
  console.log(`get ${key} from ${healthy(key).slice(0, R).join(',')}: ${kept.map((v) => `[${v.items.join('+')}] ${show(v.clock)}`).join(' | ')}`);
  return kept;
}

function handoff() {
  for (const n of Object.keys(store)) for (const v of [...store[n]]) {
    if (v.hintFor && !down.has(v.hintFor) && !down.has(n)) {
      store[v.hintFor].push({ ...v, hintFor: null });
      store[n] = store[n].filter((x) => x !== v);
      console.log(`handoff: ${n} gave ${v.key} ${show(v.clock)} back to ${v.hintFor}`);
    }
  }
}

const key = 'cart:ann';
console.log(`ring position ${position(key)}, preference list ${walk(key).slice(0, N).join(',')}`);
put(key, ['book'], {});
let [cart] = get(key);
down.add('B');
console.log('B goes down');
put(key, [...cart.items, 'pen'], cart.clock);
[cart] = get(key);
down.delete('B');
console.log('B comes back');
handoff();
console.log('two clients both start from the same cart and write through different coordinators');
const base = cart;
put(key, [...base.items, 'mug'], base.clock, 'A');
put(key, [...base.items, 'lamp'], base.clock, 'C');
const siblings = get(key);
const merged = [...new Set(siblings.flatMap((v) => v.items))].sort();
const context = siblings.reduce((acc, v) => { for (const [k, c] of Object.entries(v.clock)) acc[k] = Math.max(acc[k] ?? 0, c); return acc; }, {});
console.log(`the reader merges ${siblings.length} siblings into ${merged.join('+')}`);
put(key, merged, context);
get(key);
