// Inventory reservations and an order saga, in JavaScript:
// stock is taken with a hold that expires, an order is placed once per idempotency key,
// failures are undone in reverse order, and every status change is also written to an outbox.

const STOCK = 30, TTL = 3, BUYERS = 80, PER_TICK = 10;
const SEED = 11, TICKS = 12;
const AFTER_ALL_HOLDS = 99; // a time when every hold has expired
// Buyer behaviour, in percent: who never pays, gets declined, has shipping fail, or double-clicks.
const NO_PAY_PERCENT = 30, DECLINE_PERCENT = 15, SHIP_FAIL_PERCENT = 10, DOUBLE_CLICK_PERCENT = 20;
const PAY_DELAYS = 5; // a buyer pays 0..4 ticks after reserving
const RELAY_CRASH_PERCENT = 10;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

class Inventory {
  constructor(stock) { this.available = stock; this.holds = new Map(); } // order id -> { qty, expires }
  reserve(orderId, qty, expires) {
    if (this.holds.has(orderId)) return true;   // the same request again: already reserved
    if (this.available < qty) return false;     // the conditional decrement: never below zero
    this.available -= qty; this.holds.set(orderId, { qty, expires }); return true;
  }
  commit(orderId) { this.holds.delete(orderId); }  // the stock stays taken, and the hold is used up
  release(orderId) { const h = this.holds.get(orderId); if (h) { this.available += h.qty; this.holds.delete(orderId); } }
  restock(qty) { this.available += qty; }
  expire(now) { // give back every hold whose time ran out
    const gone = [...this.holds].filter(([, h]) => h.expires <= now).map(([id]) => id);
    gone.forEach((id) => this.release(id));
    return gone;
  }
}

const buyers = [];
for (let i = 0; i < BUYERS; i++) {
  const b = { key: `k${i}`, tick: Math.floor(i / PER_TICK) };
  b.pays = random(100) >= NO_PAY_PERCENT; b.declined = random(100) < DECLINE_PERCENT; b.delay = random(PAY_DELAYS);
  b.shipFails = random(100) < SHIP_FAIL_PERCENT; b.double = random(100) < DOUBLE_CLICK_PERCENT;
  buyers.push(b);
}

const inv = new Inventory(STOCK);
const orders = new Map(), byId = new Map(), outbox = [];
const n = { duplicates: 0, charged: 0, refunded: 0, lateLost: 0 };
function setStatus(order, status) { // the status and its event are written together, as one transaction
  order.status = status; outbox.push({ id: outbox.length + 1, type: `order.${status.toLowerCase()}`, sent: false });
}
function place(key) { // idempotent: one order per key, however many times the button is pressed
  if (orders.has(key)) { n.duplicates++; return orders.get(key); }
  const order = { id: orders.size + 1, key }; orders.set(key, order); byId.set(order.id, order); setStatus(order, 'PENDING');
  return order;
}

function pay(order, b, now) { // the saga: reserve (done) -> charge -> ship, and undo in reverse order on failure
  if (order.status === 'EXPIRED' && !inv.reserve(order.id, 1, now + TTL)) { setStatus(order, 'SOLD_OUT'); n.lateLost++; return; }
  if (b.declined) { inv.release(order.id); setStatus(order, 'DECLINED'); return; }       // undo: release the hold
  n.charged++; inv.commit(order.id);
  if (b.shipFails) { n.refunded++; inv.restock(1); setStatus(order, 'CANCELLED'); return; } // undo: refund, then restock
  setStatus(order, 'CONFIRMED');
}

const waiting = [];
for (let t = 0; t < TICKS; t++) {
  inv.expire(t).forEach((id) => setStatus(byId.get(id), 'EXPIRED'));
  for (const b of buyers.filter((x) => x.tick === t)) {
    const order = place(b.key);
    if (b.double) place(b.key);                                  // a double click
    if (!inv.reserve(order.id, 1, t + TTL)) setStatus(order, 'SOLD_OUT');
    else if (b.pays) waiting.push({ order, b, due: t + b.delay });
  }
  waiting.filter((w) => w.due === t).forEach((w) => pay(w.order, w.b, t));
}
inv.expire(AFTER_ALL_HOLDS).forEach((id) => setStatus(byId.get(id), 'EXPIRED')); // the buyers who never paid

const bus = [];
while (true) { // the relay: publish unsent rows, and sometimes crash before marking one as sent
  let crashed = false;
  for (const row of outbox) { if (row.sent) continue; bus.push(row.id); if (random(100) < RELAY_CRASH_PERCENT) { crashed = true; break; } row.sent = true; }
  if (!crashed) break;
}

const count = (s) => [...orders.values()].filter((o) => o.status === s).length;
const confirmed = count('CONFIRMED');
console.log(`orders ${orders.size}: confirmed ${confirmed}, sold out ${count('SOLD_OUT')}, declined ${count('DECLINED')}, expired ${count('EXPIRED')}, cancelled ${count('CANCELLED')}`);
console.log(`late payers who lost their stock ${n.lateLost}, double clicks absorbed ${n.duplicates}`);
console.log(`stock ${STOCK} = available ${inv.available} + sold ${confirmed}; charged ${n.charged}, refunded ${n.refunded}`);
console.log(`outbox rows ${outbox.length}, bus deliveries ${bus.length}, redelivered ${bus.length - outbox.length}, applied once ${new Set(bus).size}`);

const ok = confirmed <= STOCK && inv.available + confirmed === STOCK && inv.holds.size === 0
  && n.charged - n.refunded === confirmed && new Set(bus).size === outbox.length;
if (!ok) process.exit(1);
