// A usage meter in JavaScript: events arrive out of order and sometimes twice.
// We drop duplicates by event id, sum usage per customer and period by EVENT time,
// close each period after a grace time, and send late events to an adjustment.

const PERIOD = 1000, GRACE = 100, QUOTA = 900;
const TIERS = [[1000, 10], [1000, 8], [Infinity, 5]]; // [units in tier, cents per unit]

// Price of a total quantity, in cents (tiered: each tier is charged at its own rate).
function cost(units) {
  let left = units, cents = 0;
  for (const [size, rate] of TIERS) { const n = Math.min(left, size); cents += n * rate; left -= n; }
  return cents;
}
const money = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

const EVENTS = 2000;
const CUSTOMERS = 3;
const MAX_QTY = 5; // units per event: 1..5
const LATE_IN_10 = 2; // 2 events in 10 arrive up to 599 late, the rest within 19
const LATE_MAX = 600;
const ON_TIME_MAX = 20;
const DUP_ONE_IN = 10; // one event in 10 is delivered twice
const DUP_DELAY = 50;

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Make 2,000 events over two periods. 1 in 5 is delayed a lot, and 1 in 10 is sent twice.
const stream = [];
for (let id = 0; id < EVENTS; id++) {
  const ev = { id, customer: random(CUSTOMERS), ts: random(2 * PERIOD), qty: 1 + random(MAX_QTY) };
  const delay = random(10) < LATE_IN_10 ? random(LATE_MAX) : random(ON_TIME_MAX);
  stream.push({ ...ev, arrival: ev.ts + delay });
  if (random(DUP_ONE_IN) === 0) stream.push({ ...ev, arrival: ev.ts + delay + random(DUP_DELAY) });
}
stream.sort((a, b) => a.arrival - b.arrival || a.id - b.id);

const seen = new Set(), live = new Map(), snapshot = new Map(), closed = new Set(), late = new Map(), truth = new Map();
const crossed = new Map(); // customer -> period -> arrival time when usage passed the quota
let duplicates = 0;
const key = (c, p) => `${c}:${p}`;
const add = (m, k, q) => m.set(k, (m.get(k) || 0) + q);

function closeDue(now) { // close every period whose grace time has passed
  for (let p = 0; p < 2; p++) {
    if (!closed.has(p) && (p + 1) * PERIOD + GRACE <= now) {
      for (let c = 0; c < CUSTOMERS; c++) snapshot.set(key(c, p), live.get(key(c, p)) || 0);
      closed.add(p);
    }
  }
}

for (const ev of stream) {
  closeDue(ev.arrival);
  if (seen.has(ev.id)) { duplicates++; continue; }
  seen.add(ev.id);
  const p = Math.floor(ev.ts / PERIOD), k = key(ev.customer, p);
  add(truth, k, ev.qty);
  if (closed.has(p)) { add(late, k, ev.qty); continue; } // the invoice is already out
  add(live, k, ev.qty);
  if (live.get(k) > QUOTA && !crossed.has(k)) crossed.set(k, ev.arrival);
}
closeDue(Infinity);

console.log(`events ${stream.length}, unique ${seen.size}, duplicates dropped ${duplicates}`);
let ok = true;
for (let p = 0; p < 2; p++) {
  for (let c = 0; c < CUSTOMERS; c++) {
    const k = key(c, p), billed = snapshot.get(k), extra = late.get(k) || 0;
    const adj = cost(billed + extra) - cost(billed);
    console.log(`period ${p} customer ${c}: invoiced ${billed} units = ${money(cost(billed))}, late ${extra} units, adjustment ${money(adj)}`);
    if (billed + extra !== truth.get(k)) ok = false; // reconciliation against the raw unique events
  }
}
console.log(`quota ${QUOTA} crossed: ${[...crossed].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, t]) => `${k} at ${t}`).join(', ')}`);
console.log(`reconciled: ${ok}`);
if (!ok || seen.size + duplicates !== stream.length) process.exit(1);
