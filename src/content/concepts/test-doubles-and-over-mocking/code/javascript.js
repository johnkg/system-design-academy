// Test Doubles and Over-Mocking: an order service tested with stubs, strict mocks, mocks of everything, fakes and a contract test.
// Look for: which of 6 real bugs each style catches, and how many harmless refactors each style breaks.
// The service reserves stock, charges a payment gateway and releases the stock if the card is declined.
// The REAL gateway wants charge(currency, amount, key) with a non-empty key. A hand-written fake follows the older rules (no key).
const ORDER = [['pen', 150, 4], ['book', 1999, 1]]; // sku, price in cents, quantity: 2599 in total
const STOCK = { pen: 10, book: 5 };
const CONFIGS = [ // [name, flags, kind]: a bug is behaviour that is wrong, a refactor changes only how the service does it
  ['Healthy service', {}, 'ok'],
  ['Charges dollars, not cents', { dollars: 1 }, 'bug'],
  ['Stock not released after a decline', { noRelease: 1 }, 'bug'],
  ['Charges once per line, not once per order', { perLine: 1 }, 'bug'],
  ['Charge arguments in the wrong order', { swap: 1 }, 'bug'],
  ['No idempotency key sent', { noKey: 1 }, 'bug'],
  ['Line totals added twice in the calculator', { twice: 1 }, 'bug'],
  ['Refactor: an extra stock lookup', { extraLookup: 1 }, 'refactor'],
  ['Refactor: one reserve call for the whole order', { batch: 1 }, 'refactor'],
];
const STYLES = [ // [name, assumed cost units, gateway kind, mock the calculator, assertion kind]
  ['Stubs, assert the result', 2, 'stub', false, 'result'],
  ['Strict mocks, assert the calls', 4, 'mock', false, 'calls'],
  ['Mock everything, calculator too', 4, 'mock', true, 'calls'],
  ['Fakes, assert the state', 6, 'fake', false, 'state'],
  ['Fakes plus a contract test', 86, 'fake', false, 'state'], // the contract test runs the real sandbox gateway: 40 units per test
];

class Gateway {
  constructor(kind, decline) { this.kind = kind; this.decline = decline; this.calls = []; this.charged = []; }
  charge(cur, amt, key) {
    this.calls.push(`${cur}:${amt}`);
    if (this.kind === 'stub' || this.kind === 'mock') return { ok: !this.decline };       // canned answer
    if (cur !== 'USD') return { ok: false, code: 'bad_currency' };                          // fake and real both validate
    if (!Number.isInteger(amt) || amt <= 0) return { ok: false, code: 'bad_amount' };
    if (this.kind === 'real' && !key) return { ok: false, code: 'no_key' };                 // only the real one knows about keys
    if (amt > (this.decline ? 1000 : 100000)) return { ok: false, code: 'declined' };
    this.charged.push(amt);
    return { ok: true };
  }
}
class Inventory {
  constructor() { this.stock = { ...STOCK }; this.calls = []; }
  reserve(sku, qty) { this.calls.push(`reserve ${sku} ${qty}`); if (this.stock[sku] < qty) return false; this.stock[sku] -= qty; return true; }
  reserveAll(list) { this.calls.push('reserveAll'); for (const [sku, qty] of list) this.stock[sku] -= qty; }
  release(sku, qty) { this.calls.push(`release ${sku} ${qty}`); this.stock[sku] += qty; }
  lookup(sku) { this.calls.push(`stock ${sku}`); return this.stock[sku]; }
}
const calculator = { total: (lines, twice) => lines.reduce((s, [, p, q]) => s + p * q, 0) * (twice ? 2 : 1) };
const fixedCalculator = { total: () => 2599 }; // the "mock everything" style replaces even this

function place(order, gw, inv, calc, cfg) { // the code under test
  const total = calc.total(order, !!cfg.twice);
  const amount = cfg.dollars ? Math.floor(total / 100) : total;
  if (cfg.extraLookup) for (const [sku] of order) inv.lookup(sku);
  if (cfg.batch) inv.reserveAll(order.map(([sku, , qty]) => [sku, qty]));
  else for (const [sku, , qty] of order) inv.reserve(sku, qty);
  const key = cfg.noKey ? '' : 'order-1';
  const charges = cfg.perLine ? order.map(([, p, q]) => p * q) : [amount];
  for (const a of charges) {
    const r = cfg.swap ? gw.charge(a, 'USD', key) : gw.charge('USD', a, key);
    if (!r.ok) {
      if (!cfg.noRelease) for (const [sku, , qty] of order) inv.release(sku, qty);
      return 'declined';
    }
  }
  return 'ok';
}

// One test: place an order (or one that the gateway declines) and assert what the style asserts. Returns true when the test passes.
function test(style, gwKind, cfg, declines) {
  const [, , , mockCalc, assertion] = style;
  const gw = new Gateway(gwKind, declines), inv = new Inventory();
  const result = place(ORDER, gw, inv, mockCalc ? fixedCalculator : calculator, cfg);
  const expected = declines ? 'declined' : 'ok';
  if (result !== expected) return false;
  if (assertion === 'result') return true;
  if (assertion === 'calls') {
    const want = ['reserve pen 4', 'reserve book 1'].concat(declines ? ['release pen 4', 'release book 1'] : []);
    return gw.calls.join() === 'USD:2599' && inv.calls.join() === want.join();
  }
  const stockOk = declines ? inv.stock.pen === 10 && inv.stock.book === 5 : inv.stock.pen === 6 && inv.stock.book === 4;
  return gw.charged.join() === (declines ? '' : '2599') && stockOk;
}
function fails(style, cfg) {
  let failed = [false, true].some((d) => !test(style, style[2], cfg, d));
  if (style[0].includes('contract')) failed = failed || [false, true].some((d) => !test(style, 'real', cfg, d));
  return failed;
}

for (const style of STYLES) {
  const healthy = !fails(style, CONFIGS[0][1]);
  const bugs = CONFIGS.filter((c) => c[2] === 'bug'), refactors = CONFIGS.filter((c) => c[2] === 'refactor');
  const caught = bugs.filter((c) => fails(style, c[1])), broken = refactors.filter((c) => fails(style, c[1]));
  console.log(`${style[0]}: healthy passes ${healthy}, bugs caught ${caught.length}/${bugs.length}, refactors that break tests ${broken.length}/${refactors.length}, cost ${style[1]}`);
  console.log(`  green but wrong in production: ${bugs.filter((c) => !fails(style, c[1])).map((c) => c[0]).join('; ') || 'none'}`);
}
