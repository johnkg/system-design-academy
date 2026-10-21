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
const VELOCITY_COUNT = 3, VELOCITY_POINTS = 40, BIG_AMOUNT = 15000, BIG_POINTS = 20;
const MODEL_CAP = 60, POINTS_PER_PAYMENT = 6, TOTAL_PER_POINT = 1500, AMOUNT_PER_POINT = 1000;
const CANDIDATE_AMOUNT = 8000, CANDIDATE_POINTS = 35;
const BLOCK_AT = 70, CHALLENGE_AT = 40, MAX_SCORE = 100;
// Cost of a decision in cents: fraud that gets through a challenge, a good payment blocked, the friction of a challenge.
const CHALLENGED_FRAUD_LOSS = 300, FALSE_BLOCK_COST = 2500, CHALLENGE_FRICTION = 40;
const rules = (f) => (f.count >= VELOCITY_COUNT ? VELOCITY_POINTS : 0) + (f.amount >= BIG_AMOUNT ? BIG_POINTS : 0);
const model = (f) => Math.min(MODEL_CAP, POINTS_PER_PAYMENT * f.count + Math.floor(f.total / TOTAL_PER_POINT) + Math.floor(f.amount / AMOUNT_PER_POINT));
const candidate = (f) => (f.amount >= CANDIDATE_AMOUNT && f.count >= 1 ? CANDIDATE_POINTS : 0); // new rule, evaluated in shadow
const decide = (score) => (score >= BLOCK_AT ? 'block' : score >= CHALLENGE_AT ? 'challenge' : 'allow');

const SEED = 7, SECONDS = 1200, EVENTS_PER_SECOND = 2, CARDS = 200;
const THEFT_START = 300, FRAUD_PERCENT = 18, FRAUD_MIN = 6000, FRAUD_SPREAD = 24000;
const NORMAL_MIN = 500, NORMAL_SPREAD = 5500;
const BIG_SPENDER_EVERY = 50, BIG_SPENDER_EXTRA = 12000; // one card in 50 also makes large purchases
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const stolen = [3, 41, 77, 120, 158]; // cards that a thief is using from second 300 on
const velocity = new Velocity();
const live = { allow: 0, challenge: 0, block: 0 };
const cost = { live: 0, shadow: 0 };
const shadow = { changed: 0, caught: 0, hurt: 0 };
let fraudTotal = 0, fraudBlocked = 0, goodBlocked = 0, goodChallenged = 0;

const price = (d, fraud, amount) => (fraud ? (d === 'block' ? 0 : d === 'challenge' ? CHALLENGED_FRAUD_LOSS : amount) : d === 'block' ? FALSE_BLOCK_COST : d === 'challenge' ? CHALLENGE_FRICTION : 0);

for (let t = 0; t < SECONDS; t++) {
  for (let k = 0; k < EVENTS_PER_SECOND; k++) { // two events per second: a normal purchase, or a thief using a stolen card
    const fraud = t >= THEFT_START && random(100) < FRAUD_PERCENT;
    const card = fraud ? stolen[random(stolen.length)] : random(CARDS);
    const amount = fraud ? FRAUD_MIN + random(FRAUD_SPREAD) : NORMAL_MIN + random(NORMAL_SPREAD) + (card % BIG_SPENDER_EVERY === 9 ? random(BIG_SPENDER_EXTRA) : 0);
    const f = { ...velocity.read(card, t), amount };
    const base = Math.min(MAX_SCORE, rules(f) + model(f)), withNew = Math.min(MAX_SCORE, base + candidate(f));
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
if (live.allow + live.challenge + live.block !== SECONDS * EVENTS_PER_SECOND || fraudBlocked > fraudTotal || shadow.caught + shadow.hurt !== shadow.changed) process.exit(1);
