// Command-Query Separation: a cart total and a ticket counter, built three ways.
// Look for: reads that change state (a total that spends a coupon), and the race that appears when a combined
// "read then change" is split into two calls with nothing making them atomic.
// Cart: subtotal 100, a one-time coupon worth 10, so the right total is 90 every time it is read.
// Tickets: the counter starts at 7; two workers each take one ticket at the same moment.

class MixedCart { // total() reads AND spends the coupon the first time it is called
  constructor() { this.coupon = 10; }
  total() { let t = 100; if (this.coupon > 0) { t -= this.coupon; this.coupon = 0; } return t; }
}
class SeparatedCart { // applyCoupon() is the command, total() is a pure query
  constructor() { this.discount = 0; }
  applyCoupon() { this.discount = 10; }
  total() { return 100 - this.discount; }
}

class MixedCounter { // nextTicket() changes and returns in one step: no other worker can slip in between
  constructor() { this.n = 7; }
  nextTicket() { return this.n++; }
}
class StrictCounter { // peek() is a query, advance() is a command; taking a ticket needs both calls
  constructor() { this.n = 7; }
  peek() { return this.n; }
  advance() { this.n++; }
}

const DESIGNS = ['Mixed everywhere', 'Strict separation everywhere', 'Separated, with a named atomic exception'];

// Situation 1 and 2: the page reads the total; situation 2 adds one debug log line that reads it first.
function cartRun(design, situation) {
  const reads = situation === 1 ? 3 : 4;
  const shown = [];
  let changed = 0;
  if (design === 0) {
    const c = new MixedCart();
    for (let i = 0; i < reads; i++) { const before = c.coupon; shown.push(c.total()); if (c.coupon !== before) changed++; }
  } else {
    const c = new SeparatedCart();
    c.applyCoupon(); // one explicit command at checkout
    for (let i = 0; i < reads; i++) shown.push(c.total());
  }
  const page = situation === 1 ? shown : shown.slice(1); // the log line is the first read in situation 2
  const distinct = new Set(page).size;
  const wrong = page.filter((v) => v !== 90).length; // the right total is 90
  return { page, changed, distinct, wrong };
}

// Situation 3: two workers each take a ticket. Atomic operations run whole; split calls interleave A1 B1 A2 B2.
function ticketRun(design) {
  const issued = [];
  let counter;
  if (design === 1) {
    const c = new StrictCounter();
    const a = c.peek(); const b = c.peek(); c.advance(); c.advance();
    issued.push(a, b); counter = c.n;
  } else {
    const c = new MixedCounter(); // design 0 and design 2 (takeTicket) behave the same here
    issued.push(c.nextTicket(), c.nextTicket()); counter = c.n;
  }
  const distinct = new Set(issued).size;
  return { issued, counter, duplicates: issued.length - distinct, skipped: (counter - 7) - distinct, calls: design === 1 ? 2 : 1 };
}

for (let d = 0; d < 3; d++) {
  console.log(`== ${DESIGNS[d]}`);
  for (const s of [1, 2]) {
    const r = cartRun(d, s);
    console.log(`  ${s === 1 ? 'page reads total 3 times' : 'page plus one debug log read'}: page shows ${r.page.join(', ')}; reads that changed state: ${r.changed}; distinct totals on the page: ${r.distinct}; page reads showing a wrong total: ${r.wrong}`);
  }
  const t = ticketRun(d);
  console.log(`  two workers take a ticket: issued ${t.issued.join(', ')}; counter ends at ${t.counter}; duplicates: ${t.duplicates}; numbers skipped: ${t.skipped}; calls per ticket: ${t.calls}`);
}
