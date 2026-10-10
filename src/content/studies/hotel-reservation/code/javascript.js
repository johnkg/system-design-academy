// A hotel booking core in JavaScript: one inventory row per room type and night, an all-or-nothing conditional update across the nights of a stay,
// holds that expire, idempotent requests, and a small overbooking allowance.

const NIGHTS = 7, CAPACITY = 10, OVERBOOK = 1, HOLD_TTL = 6; // 10 rooms of one type, one extra allowed, holds last 6 ticks

class Inventory {
  constructor(limit) {
    this.limit = limit;
    this.rows = Array.from({ length: NIGHTS }, () => ({ sold: 0, held: 0 })); // one row per night
    this.holds = new Map(); // idempotency key -> hold
    this.replays = 0;
  }

  // UPDATE row SET held = held + 1 WHERE night = ? AND sold + held < limit, for each night. If any night fails, undo the ones that worked.
  hold(key, from, to, now) {
    if (this.holds.has(key)) { this.replays++; return this.holds.get(key); } // same key again: return the same answer
    const done = [];
    for (let n = from; n < to; n++) {
      const row = this.rows[n];
      if (row.sold + row.held >= this.limit) { done.forEach((d) => this.rows[d].held--); return this.remember(key, { state: 'rejected' }); }
      row.held++; done.push(n);
    }
    return this.remember(key, { state: 'held', from, to, expires: now + HOLD_TTL });
  }

  remember(key, hold) { this.holds.set(key, hold); return hold; }

  confirm(key, now) { // payment succeeded
    const h = this.holds.get(key);
    if (!h || h.state !== 'held' || now >= h.expires) return false; // a late payment finds the hold gone
    for (let n = h.from; n < h.to; n++) { this.rows[n].held--; this.rows[n].sold++; }
    h.state = 'sold';
    return true;
  }

  expire(now) { // a sweeper gives back holds whose time ran out
    let freed = 0;
    for (const h of this.holds.values()) {
      if (h.state === 'held' && now >= h.expires) { for (let n = h.from; n < h.to; n++) this.rows[n].held--; h.state = 'expired'; freed++; }
    }
    return freed;
  }
}

let seed = 4242;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// 60 requests, one per tick. Each wants 1 to 3 nights, pays 2 ticks later unless it abandons, and every 7th request is sent twice.
const requests = Array.from({ length: 60 }, (_, i) => {
  const len = 1 + random(3), from = random(NIGHTS - len + 1);
  return { key: `req-${i}`, from, to: from + len, pays: random(100) < 70 };
});

// The mistake: everyone reads the free count first, then writes. Here 12 requests read the same snapshot.
const naive = new Array(NIGHTS).fill(0);
for (let i = 0; i < requests.length; i += 12) {
  const snapshot = naive.slice();
  for (const r of requests.slice(i, i + 12)) {
    let free = true;
    for (let n = r.from; n < r.to; n++) if (snapshot[n] >= CAPACITY) free = false;
    if (free) for (let n = r.from; n < r.to; n++) naive[n]++;
  }
}
const naiveOver = naive.reduce((s, x) => s + Math.max(0, x - CAPACITY), 0);

const inv = new Inventory(CAPACITY + OVERBOOK);
const pending = [];
let rejected = 0, sold = 0, expired = 0;
for (let t = 0; t < requests.length + HOLD_TTL + 2; t++) {
  expired += inv.expire(t);
  for (const p of pending.filter((p) => p.at === t)) if (inv.confirm(p.key, t)) sold++;
  const r = requests[t];
  if (r) {
    const h = inv.hold(r.key, r.from, r.to, t);
    if (h.state === 'rejected') rejected++; else if (r.pays) pending.push({ key: r.key, at: t + 2 });
    if (t % 7 === 0) inv.hold(r.key, r.from, r.to, t); // a client retry with the same key
  }
}

const usage = inv.rows.map((row) => row.sold + row.held);
console.log(`read then write: nights sold beyond ${CAPACITY} rooms = ${naiveOver}`);
console.log(`conditional update: sold ${sold}, rejected ${rejected}, holds expired ${expired}, retries replayed ${inv.replays}`);
console.log(`rooms used per night: ${usage.join(' ')} (limit ${CAPACITY + OVERBOOK})`);

// Overbooking: guests who cancel or do not show up leave rooms empty, and the allowance sells them twice.
const sold10 = inv.rows.map((row) => row.sold);
// Pretend that 0%, 10% or 20% of the guests booked for a night do not arrive, depending on the night.
const shown = sold10.map((s, i) => Math.floor((s * (10 - (i % 3)) + 5) / 10));
const walked = shown.reduce((s, x) => s + Math.max(0, x - CAPACITY), 0);
console.log(`sold per night: ${sold10.join(' ')}; guests who arrive: ${shown.join(' ')}; guests without a room: ${walked}`);

if (naiveOver === 0) process.exit(1);
if (usage.some((u) => u > CAPACITY + OVERBOOK)) process.exit(1);
if (inv.rows.some((row) => row.held !== 0)) process.exit(1); // every hold ended as sold or expired
