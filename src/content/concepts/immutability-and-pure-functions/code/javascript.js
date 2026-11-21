// Immutability and pure functions: a shared-state bug, then the cost of avoiding it, in element copies (never time).
// Look for: the impure preview gives three different totals for one cart; copying everything costs n per update, structural sharing
// costs a fixed few dozen, and for tiny lists plain copying is cheaper. Costs here come from an explicit model, stated in each comment.
const COUPON = 90; // percent of the price left after a 10 percent coupon
const sum = (a) => a.reduce((x, y) => x + y, 0);

function previewImpure(cart) { // applies the coupon to the caller's list, then sums it
  for (let i = 0; i < cart.length; i++) cart[i] = Math.floor(cart[i] * COUPON / 100);
  return sum(cart);
}

function previewPure(cart) { // returns a new total and leaves the caller's list alone
  return sum(cart.map((p) => Math.floor(p * COUPON / 100)));
}

let cart = [1000, 2500, 400]; // prices in cents
let totals = [0, 1, 2].map(() => previewImpure(cart)); // header badge, checkout summary, email
console.log(`impure preview, one cart, three widgets: ${totals[0]}, ${totals[1]}, ${totals[2]}`);
cart = [1000, 2500, 400];
totals = [0, 1, 2].map(() => previewPure(cart));
console.log(`pure preview, one cart, three widgets: ${totals[0]}, ${totals[1]}, ${totals[2]}`);

// Aliasing: three readers hold the same list; a writer changes the first element.
let data = [10, 20, 30, 40, 50];
let readers = [data, data, data];
data[0] += 1;
console.log(`readers that saw the change when the list is shared and mutated: ${readers.filter((r) => r[0] !== 10).length} of 3`);
data = Object.freeze([10, 20, 30, 40, 50]);
readers = [data, data, data];
data = Object.freeze([11, ...data.slice(1)]); // a new value; the old one is untouched
console.log(`readers that saw the change when updates build a new value: ${readers.filter((r) => r[0] !== 10).length} of 3`);

function treeDepth(n) { // levels of a 32-way tree that holds n items
  let levels = 1, capacity = 32;
  while (capacity < n) { capacity *= 32; levels++; }
  return levels;
}

const UPDATES = 100;
for (const n of [10, 100, 1000, 10000]) {
  const inPlace = UPDATES; // one write per update
  const copyAll = UPDATES * n; // each update copies all n items
  const sharing = UPDATES * treeDepth(n) * 32; // model: each update copies one 32-slot node per tree level
  const priv = n + UPDATES; // copy once, mutate the private copy, then hand it out
  console.log(`n=${n}, ${UPDATES} updates: in place ${inPlace}, copy every time ${copyAll}, structural sharing ${sharing}, private copy then freeze ${priv}`);
}

let n = 1;
while (!(treeDepth(n) * 32 < n)) n++;
console.log(`structural sharing is cheaper than copying everything only from n = ${n}`);
