// Coupling and cohesion. Part 1 reads a customer's country three ways (through shared global state, by reaching through
// strangers, through a narrow method) and counts the calls in each chain (the Law of Demeter). Part 2 is a model of one checkout
// feature built four ways, as a module graph whose edges have a coupling kind; for three change requests it counts the other
// modules that must change and the modules and responsibilities to re-test. Look for: the chain lengths, and what a one-module
// design does to "modules that change" and to the size of what is re-tested.
let calls = 0; // every call the reading code makes on an object; the hand-offs Cart makes inside shippingCountry() are Cart's own business and are not counted
class Address { constructor(country) { this._country = country; } getCountry() { calls++; return this._country; } country() { return this._country; } }
class Customer { constructor(address) { this._address = address; } getAddress() { calls++; return this._address; } country() { return this._address.country(); } }
class Cart { // a cart may know its own customer; callers should not have to
  constructor(customer) { this._customer = customer; }
  getCustomer() { calls++; return this._customer; }
  shippingCountry() { calls++; return this._customer.country(); } // narrow: asks Customer, which asks Address; no private field is read
}
class State { constructor(cart) { this._cart = cart; } getCart() { calls++; return this._cart; } }
const cart = new Cart(new Customer(new Address('DE'))), GLOBAL = new State(cart);
for (const [label, read] of [
  ['shared global state', () => GLOBAL.getCart().getCustomer().getAddress().getCountry()],
  ['reaching through strangers', () => cart.getCustomer().getAddress().getCountry()],
  ['narrow interface', () => cart.shippingCountry()]]) {
  calls = 0; const country = read();
  console.log(`${label}: ${country} after ${calls} call${calls === 1 ? '' : 's'}`);
}

// Part 2: the module graph. An edge a -> b means a depends on b, with a kind from loosest to tightest.
const WEIGHT = { data: 1, stamp: 2, control: 3, common: 4, content: 5 };
// A change reaches a dependent only through an edge at least this tight: an internal rewrite (level 1) is seen only by modules
// that reach into internals, a change of a data structure (level 2) by those that share or pass the structure around, a change
// of an operation's signature (level 3) by every caller. A module that has to change absorbs it and does not pass it on.
const THRESHOLD = { 1: 5, 2: 2, 3: 1 };
const NAMES = ['Checkout', 'Cart', 'Pricing', 'Inventory', 'Billing', 'Notifications', 'Reports'];
const mods = NAMES.map((n) => ({ name: n, has: [n] }));
const FLOW = [['Checkout', 'Cart'], ['Checkout', 'Pricing'], ['Checkout', 'Inventory'], ['Checkout', 'Billing'], ['Checkout', 'Notifications'],
  ['Pricing', 'Cart'], ['Inventory', 'Cart'], ['Billing', 'Pricing'], ['Notifications', 'Billing'], ['Notifications', 'Cart'],
  ['Reports', 'Cart'], ['Reports', 'Pricing'], ['Reports', 'Inventory'], ['Reports', 'Billing']];
const DESIGNS = [
  ['shared global state', mods, FLOW.map(([a, b]) => ({ a, b, kind: 'common' }))],
  ['reaching into internals', mods, FLOW.map(([a, b]) => ({ a, b, kind: 'content' }))],
  ['narrow interfaces', mods, [['Checkout', 'Cart', 'data'], ['Checkout', 'Pricing', 'stamp'], ['Checkout', 'Inventory', 'data'], ['Checkout', 'Billing', 'data'],
    ['Checkout', 'Notifications', 'control'], ['Reports', 'Checkout', 'stamp']].map(([a, b, kind]) => ({ a, b, kind }))],
  ['one big module', [{ name: 'Monolith', has: NAMES }], []],
];
const CHANGES = [['add a currency field to the price structure', 'Pricing', 2], ['rewrite how stock is reserved (internal)', 'Inventory', 1], ['change the signature of the charge call', 'Billing', 3]];

function blast(mods, edges, resp, level) {
  const home = mods.find((m) => m.has.includes(resp)).name;
  const change = new Set([home]);
  for (const e of edges) if (e.b === home && WEIGHT[e.kind] >= THRESHOLD[level]) change.add(e.a);
  const retest = new Set(change);
  for (const e of edges) if (change.has(e.b)) retest.add(e.a);
  return { change: [...change], retest: [...retest], resp: [...retest].reduce((s, n) => s + mods.find((m) => m.name === n).has.length, 0) };
}
for (const [label, ms, edges] of DESIGNS) {
  const score = edges.reduce((s, e) => s + WEIGHT[e.kind], 0), biggest = Math.max(...ms.map((m) => m.has.length));
  console.log(`-- ${label}: ${edges.length} dependencies, coupling score ${score}, largest module holds ${biggest} responsibilities`);
  for (const [text, resp, level] of CHANGES) {
    const r = blast(ms, edges, resp, level);
    console.log(`  ${text}: ${r.change.length - 1} other modules must change (${r.change.slice(1).join(', ') || 'none'}); ${r.retest.length} modules and ${r.resp} responsibilities re-tested`);
  }
}
