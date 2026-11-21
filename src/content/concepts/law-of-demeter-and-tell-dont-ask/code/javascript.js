// Law of Demeter and Tell, Don't Ask. Part 1 runs real objects (Order, Customer, Address, Country) through a change: customers get a
// separate shipping address, and the old `address` becomes the billing one. Call sites that reach through the chain keep compiling
// and silently charge the wrong tax; the one that tells the order what to do is fixed in one place. Part 2 counts what each design
// makes you edit for four change requests, from a small model of a codebase: 12 call sites, 4 classes, 8 pieces of data.
// Look for: 190 vs 200, and how the edits spread (7 modules vs 1 class), and the price of forwarding everything.

class Country {
  constructor(name, rate) { this.name = name; this.rate = rate; }
  taxOn(amount) { return Math.floor((amount * this.rate) / 100); }
}
class Address {
  constructor(street, country) { this.street = street; this.country = country; }
  taxOn(amount) { return this.country.taxOn(amount); }
}
class Customer {
  constructor(name, address, shipping = null) {
    this.name = name;
    this.address = address; // v1: the only address; v2: kept for old code, now means "billing"
    this.shipping = shipping || address;
  }
  taxOn(amount) { return this.shipping.taxOn(amount); } // the one place that knows which address tax follows
}
class Order {
  constructor(customer, total) { this.customer = customer; this.total = total; }
  tax() { return this.customer.taxOn(this.total); } // tell, don't ask: the order answers, callers do not navigate
}

// Call sites written the train-wreck way: each one reaches through four objects.
const checkoutTax = (order) => Math.floor((order.total * order.customer.address.country.rate) / 100);
const quoteTax = (order) => Math.floor((order.total * order.customer.address.country.rate) / 100);

const DE = new Country("DE", 19), FR = new Country("FR", 20);
const v1 = new Order(new Customer("ann", new Address("1 Main St", DE)), 1000);
console.log(`v1, one address (DE): checkout ${checkoutTax(v1)}, quote ${quoteTax(v1)}, order.tax() ${v1.tax()}`);
const v2 = new Order(new Customer("ann", new Address("1 Main St", DE), new Address("2 Rue Neuve", FR)), 1000);
console.log(`v2, billing DE, shipping FR: checkout ${checkoutTax(v2)}, quote ${quoteTax(v2)}, order.tax() ${v2.tax()}`);

// Part 2. A model of the codebase. Classes form a chain; each piece of data lives in one class (its owner).
const CLASSES = ["Order", "Customer", "Address", "Country"];
const OWNER = [1, 1, 2, 2, 3, 3, 3, 3]; // name, tier, street, city, country name, tax rate, zone, code
const SITES = [["email", 0], ["invoice", 0], ["loyalty", 1], ["shipping", 2], ["shipping", 3], ["invoice", 4],
  ["report", 4], ["checkout", 5], ["quote", 5], ["shipping", 6], ["fraud", 7], ["export", 2]]; // [module, data it reads]
const TELL = [["greeting", [0], 1], ["standing", [1], 1], ["label", [2, 3, 4], 2],
  ["tax", [5], 3], ["zone", [6], 3], ["risk", [7], 3]]; // [method, data it reads, class where it lives]
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

function units(design) {
  // A unit is one piece of code that can need editing: [where, links of the chain it crosses, data whose rule it holds].
  const u = [];
  if (design === "train") { // every call site walks the chain itself
    for (const [m, op] of SITES) u.push([m, new Set(range(1, OWNER[op] + 1)), new Set([op])]);
  } else if (design === "forward") { // every class forwards every leaf below it; call sites still decide what to do with the data
    for (const [m, op] of SITES) u.push([m, new Set(), new Set([op])]);
    for (let op = 0; op < 8; op++)
      for (let c = 0; c <= OWNER[op]; c++) u.push([CLASSES[c], c < OWNER[op] ? new Set([c + 1]) : new Set(), new Set()]);
  } else { // tell: one method per behaviour, living where its data is, with one-line hops above it
    for (const [m] of SITES) u.push([m, new Set(), new Set()]);
    for (const [, reads, home] of TELL) {
      const top = Math.max(...reads.map((o) => OWNER[o]));
      for (let c = 0; c <= home; c++)
        u.push([CLASSES[c], c < home ? new Set([c + 1]) : new Set(range(home + 1, top + 1)), c === home ? new Set(reads) : new Set()]);
    }
  }
  return u;
}

const CHANGES = [["Customer gets several addresses", "shape", 2], ["Address keeps its country as a code", "shape", 3],
  ["Tax rule changes", "rule", 5], ["Country gets a currency", "new", 3]];

function edited(design, kind, arg) {
  if (kind === "new") return ["checkout", ...(design === "train" ? [] : CLASSES.slice(0, arg + 1))]; // a new site, plus a hop in every class on the way down
  if (kind === "shape") return units(design).filter(([, links]) => links.has(arg)).map(([w]) => w);
  return units(design).filter(([, , logic]) => logic.has(arg)).map(([w]) => w);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const FORWARDERS = { train: 0, tell: sum(TELL.map((t) => t[2])), forward: sum(OWNER) };
const ORDER_METHODS = { train: 0, tell: TELL.length, forward: OWNER.length };
for (const design of ["train", "tell", "forward"]) {
  const row = [];
  let edits = 0, places = 0;
  for (const [, kind, arg] of CHANGES) {
    const e = edited(design, kind, arg);
    edits += e.length;
    places += new Set(e).size;
    row.push(`edits ${e.length} places ${new Set(e).size}`);
  }
  console.log(`${design}: ${row.join(" | ")} | total ${edits} edits, ${places} places | order methods ${ORDER_METHODS[design]}, ` +
    `forwarding-only methods ${FORWARDERS[design]}`);
}
