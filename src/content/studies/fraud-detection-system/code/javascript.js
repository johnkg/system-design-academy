// A real-time fraud scorer in JavaScript: velocity counters in time buckets, rules plus a small model,
// a decision (allow, challenge, block), and a candidate rule tested in shadow mode against later chargeback labels.

const BUCKET = 10, BUCKETS = 6; // a 60-second window made of six 10-second buckets

class Velocity {
  constructor() { this.cards = new Map(); }
  // Count and total of the card's payments in the last 60 seconds, read before the new payment is added.
  read(card, t) {
    const c = this.cards.get(card);
    const now = Math.floor(t / BUCKET), out = { count: 0, total: 0 };
    if (!c) return out;
    for (let i = 0; i < BUCKETS; i++) if (c.id[i] !== -1 && now - c.id[i] < BUCKETS) { out.count += c.n[i]; out.total += c.sum[i]; }
    return out;
  }
  add(card, t, amount) {
    if (!this.cards.has(card)) this.cards.set(card, { id: Array(BUCKETS).fill(-1), n: Array(BUCKETS).fill(0), sum: Array(BUCKETS).fill(0) });
    const c = this.cards.get(card), now = Math.floor(t / BUCKET), slot = now % BUCKETS;
    if (c.id[slot] !== now) { c.id[slot] = now; c.n[slot] = 0; c.sum[slot] = 0; } // a stale bucket is reused
    c.n[slot]++; c.sum[slot] += amount;
  }
}

// Rules are exact and explainable; the model adds a graded score from the same features. Amounts are in cents.
const rules = (f) => (f.count >= 3 ? 40 : 0) + (f.amount >= 15000 ? 20 : 0);
const model = (f) => Math.min(60, 6 * f.count + Math.floor(f.total / 1500) + Math.floor(f.amount / 1000));
const candidate = (f) => (f.amount >= 8000 && f.count >= 1 ? 35 : 0); // new rule, evaluated in shadow
const decide = (score) => (score >= 70 ? 'block' : score >= 40 ? 'challenge' : 'allow');

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const stolen = [3, 41, 77, 120, 158]; // cards that a thief is using from second 300 on
const velocity = new Velocity();
const live = { allow: 0, challenge: 0, block: 0 };
const cost = { live: 0, shadow: 0 };
const shadow = { changed: 0, caught: 0, hurt: 0 };
let fraudTotal = 0, fraudBlocked = 0, goodBlocked = 0, goodChallenged = 0;

const price = (d, fraud, amount) => (fraud ? (d === 'block' ? 0 : d === 'challenge' ? 300 : amount) : d === 'block' ? 2500 : d === 'challenge' ? 40 : 0);

for (let t = 0; t < 1200; t++) {
  for (let k = 0; k < 2; k++) { // two events per second: a normal purchase, or a thief using a stolen card
    const fraud = t >= 300 && random(100) < 18;
    const card = fraud ? stolen[random(stolen.length)] : random(200);
    const amount = fraud ? 6000 + random(24000) : 500 + random(5500) + (card % 50 === 9 ? random(12000) : 0);
    const f = { ...velocity.read(card, t), amount };
    const base = Math.min(100, rules(f) + model(f)), withNew = Math.min(100, base + candidate(f));
    const d = decide(base), dNew = decide(withNew); // only d is acted on
    live[d]++;
    if (fraud) { fraudTotal++; if (d === 'block') fraudBlocked++; } else { if (d === 'block') goodBlocked++; if (d === 'challenge') goodChallenged++; }
    cost.live += price(d, fraud, amount); cost.shadow += price(dNew, fraud, amount);
    if (dNew !== d) { shadow.changed++; if (fraud) shadow.caught++; else shadow.hurt++; }
    velocity.add(card, t, amount);
  }
}

console.log(`decisions: allow ${live.allow}, challenge ${live.challenge}, block ${live.block}`);
console.log(`fraud blocked ${fraudBlocked} of ${fraudTotal}; good payments blocked ${goodBlocked}, challenged ${goodChallenged}`);
console.log(`shadow rule would change ${shadow.changed} decisions: ${shadow.caught} on fraud, ${shadow.hurt} on good payments`);
console.log(`loss in cents with the live rules ${cost.live}, with the candidate added ${cost.shadow}`);
const promote = cost.shadow < cost.live;
console.log(`promote the candidate rule: ${promote}`);
if (live.allow + live.challenge + live.block !== 2400 || fraudBlocked > fraudTotal || shadow.caught + shadow.hurt !== shadow.changed) process.exit(1);
