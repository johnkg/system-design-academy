// Anemic vs rich domain models: an Order with four rules (ship only when paid, ship only when not empty, no items added
// after shipping, discount at most 50%), built three ways. Five code paths each try all four forbidden changes (20 attempts).
// Three paths go through the OrderService (checkout, REST controller, nightly job); two write fields directly (support
// admin tool, CSV import job). Look for: how many forbidden changes get in, how many places a new rule must be written,
// and what a plain lookup table (Country) costs when it is given the same treatment as the Order.
const FORBIDDEN = ['ship an unpaid order', 'ship an empty order', 'add an item to a shipped order', 'give an 80% discount'];
const CALLERS = [
  { name: 'Checkout service', direct: false }, { name: 'REST controller', direct: false }, { name: 'Support admin tool', direct: true },
  { name: 'CSV import job', direct: true }, { name: 'Nightly job', direct: false },
];

class AnemicOrder { constructor() { this.items = []; this.paid = false; this.shipped = false; this.discount = 0; } } // fields only
class OrderService { // the rules live in the service
  addItem(o, i) { if (o.shipped) throw new Error('shipped'); o.items.push(i); }
  pay(o) { o.paid = true; }
  ship(o) { if (!o.paid) throw new Error('unpaid'); if (o.items.length === 0) throw new Error('empty'); o.shipped = true; }
  applyDiscount(o, p) { if (p > 50) throw new Error('too high'); o.discount = p; }
}
class RichOrder { // the rules live in the object, and the fields are only reachable through its methods
  #items = []; #paid = false; #shipped = false; #discount = 0;
  addItem(i) { if (this.#shipped) throw new Error('shipped'); this.#items.push(i); }
  pay() { this.#paid = true; }
  ship() { if (!this.#paid) throw new Error('unpaid'); if (this.#items.length === 0) throw new Error('empty'); this.#shipped = true; }
  applyDiscount(p) { if (p > 50) throw new Error('too high'); this.#discount = p; }
}
class EverywhereOrder extends RichOrder { // rich everywhere: persistence and email are behaviour of the entity too
  constructor(db, mailer) { super(); if (!db || !mailer) throw new Error('needs a database and a mailer'); this.db = db; this.mailer = mailer; }
  save() { this.db.write(); } emailReceipt() { this.mailer.send(); } renderInvoice() { return 'html'; }
}

const svc = new OrderService();
// An order in the state a given forbidden change needs, built only through legal operations.
function anemicOrder(k) { const o = new AnemicOrder(); if (k !== 1) svc.addItem(o, 'a'); if (k !== 0) svc.pay(o); if (k === 2) svc.ship(o); return o; }
function richOrder(k, make) { const o = make(); if (k !== 1) o.addItem('a'); if (k !== 0) o.pay(); if (k === 2) o.ship(); return o; }

function attempt(design, caller, k) { // true when the forbidden change got in
  try {
    if (design === 0) {
      const o = anemicOrder(k);
      if (!caller.direct) { if (k < 2) svc.ship(o); else if (k === 2) svc.addItem(o, 'b'); else svc.applyDiscount(o, 80); }
      else if (k < 2) o.shipped = true; else if (k === 2) o.items.push('b'); else o.discount = 80;
    } else {
      const o = richOrder(k, design === 1 ? () => new RichOrder() : () => new EverywhereOrder({ write() {} }, { send() {} }));
      if (k < 2) o.ship(); else if (k === 2) o.addItem('b'); else o.applyDiscount(80);
    }
    return true;
  } catch (e) { return false; }
}

const DESIGNS = [
  { name: 'Anemic: fields plus a service', where: () => ['OrderService', ...CALLERS.filter((c) => c.direct).map((c) => c.name)],
    country: { methods: 2, note: 'Country (2 fields) and a repository with find and save' }, needs: 0 },
  { name: 'Rich where rules exist', where: () => ['Order'],
    country: { methods: 2, note: 'Country (2 fields) and a repository with find and save: nothing to protect, so nothing added' }, needs: 0 },
  { name: 'Rich everywhere', where: () => ['Order'],
    country: { methods: 8, note: 'Country with validate, rename, equals, display, save and load on top of find and save' }, needs: 2 },
];

for (let d = 0; d < DESIGNS.length; d++) {
  const D = DESIGNS[d];
  let accepted = 0; const through = new Set();
  for (const c of CALLERS) for (let k = 0; k < FORBIDDEN.length; k++) if (attempt(d, c, k)) { accepted++; through.add(c.name); }
  console.log(`== ${D.name}`);
  console.log(`  forbidden changes accepted: ${accepted} of ${CALLERS.length * FORBIDDEN.length}${accepted ? ` (got in through: ${[...through].join(', ')})` : ''}`);
  console.log(`  new rule "no discount on a shipped order": places to write it ${D.where().length} (${D.where().join(', ')})`);
  console.log(`  collaborators needed to test one rule: ${D.needs}`);
  console.log(`  plain lookup table (Country): methods written ${D.country.methods}, rules protected 0 (${D.country.note})`);
}
