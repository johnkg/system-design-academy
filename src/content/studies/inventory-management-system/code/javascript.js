// Stock as a ledger of movements, in JavaScript:
// the balance is the sum of the movements, a reservation holds units until it expires or is paid,
// and a reservation is only granted if balance minus holds still covers it.

const TTL = 10; // a hold lasts 10 ticks

class Inventory {
  constructor(warehouses) {
    this.ledger = [];                                  // append-only: { wh, delta, kind, ref }
    this.balance = Array(warehouses).fill(0);          // projection: the sum of the ledger per warehouse
    this.held = Array(warehouses).fill(0);             // units promised to active reservations
    this.reservations = new Map();                     // id -> { wh, qty, expires, state }
    this.minAvailable = 0;
  }

  move(wh, delta, kind, ref) {
    this.ledger.push({ wh, delta, kind, ref });
    this.balance[wh] += delta;
  }

  available(wh) { return this.balance[wh] - this.held[wh]; }

  reserve(id, qty, now) {
    const known = this.reservations.get(id);
    if (known) return true;                            // a retry of the same request changes nothing
    const wh = this.balance.findIndex((_, w) => this.available(w) >= qty);
    if (wh < 0) return false;                          // the check and the hold are one step
    this.held[wh] += qty;
    this.reservations.set(id, { wh, qty, expires: now + TTL, state: 'held' });
    this.minAvailable = Math.min(this.minAvailable, ...this.balance.map((_, w) => this.available(w)));
    return true;
  }

  expire(now) {
    let n = 0;
    for (const r of this.reservations.values()) {
      if (r.state === 'held' && r.expires <= now) { r.state = 'expired'; this.held[r.wh] -= r.qty; n++; }
    }
    return n;
  }

  commit(id, now) {
    const r = this.reservations.get(id);
    if (!r || r.state !== 'held' || now >= r.expires) return false; // too late: the units went back on sale
    r.state = 'sold'; this.held[r.wh] -= r.qty;
    this.move(r.wh, -r.qty, 'pick', id);
    return true;
  }
}

let seed = 7;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const inv = new Inventory(2);
inv.move(0, 60, 'receipt', 'po-1'); inv.move(1, 40, 'receipt', 'po-2');
const physical = [60, 40];                              // what is really on the shelves
let next = 0, rejected = 0, accepted = 0, sold = 0, expired = 0, late = 0;
const pending = [];                                     // { id, payAt }
for (let now = 0; now < 200; now++) {
  expired += inv.expire(now);
  if (now === 100) { inv.move(1, 150, 'receipt', 'po-3'); physical[1] += 150; } // a delivery arrives
  for (let k = 1 + rnd(3); k > 0; k--) {
    const id = 'r' + next++, qty = 1 + rnd(3);
    if (inv.reserve(id, qty, now)) { accepted++; if (rnd(100) < 65) pending.push({ id, payAt: now + 1 + rnd(14) }); } else rejected++;
  }
  for (const p of pending.filter((p) => p.payAt === now)) {
    const qty = inv.reservations.get(p.id).qty;
    if (inv.commit(p.id, now)) { sold += qty; physical[inv.reservations.get(p.id).wh] -= qty; } else late++;
  }
}
inv.reserve('r0', 1, 200);                              // replay of an old id: no new hold
physical[1] -= 3;                                       // three units were damaged or stolen, and nobody recorded it

console.log(`requests ${next}: accepted ${accepted}, rejected ${rejected}`);
console.log(`units sold ${sold}, holds expired ${expired}, payments refused as late ${late}`);
console.log(`lowest available ever: ${inv.minAvailable}`);
for (let w = 0; w < 2; w++) console.log(`warehouse ${w}: balance ${inv.balance[w]}, held ${inv.held[w]}, shelf ${physical[w]}`);
for (let w = 0; w < 2; w++) {
  const diff = physical[w] - inv.balance[w];
  if (diff !== 0) inv.move(w, diff, 'count', 'cc-1');
  console.log(`cycle count warehouse ${w}: adjustment ${diff}`);
}
const replay = [0, 0];
for (const e of inv.ledger) replay[e.wh] += e.delta;
const ok = replay.every((v, w) => v === inv.balance[w] && v === physical[w]);
console.log(`ledger entries ${inv.ledger.length}; replay matches balances and shelves: ${ok}`);
if (inv.minAvailable < 0 || !ok) process.exit(1);
