// An experimentation core in JavaScript: hash bucketing, ramp-ups, layers, a sample-ratio check and a significance test with peeking.
// All maths on counts is exact; the draws come from a seeded integer generator, so every run prints the same numbers.

const fnv1a = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
// A salt plus the user id gives a number in 0..9999. The finalizer mixes the bits so the low digits are even.
const bucket = (salt, user) => { let h = fnv1a(`${salt}:${user}`); h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) % 10000; };

// layer: experiments in one layer own separate slices of 0..9999, so a user is in at most one of them.
const assign = (exp, user) => {
  if (exp.slice) { const b = bucket(`layer-${exp.layer}`, user); if (b < exp.slice[0] || b >= exp.slice[1]) return null; }
  if (bucket(`${exp.salt}:ramp`, user) >= exp.ramp) return null;                  // not ramped in yet
  return bucket(`${exp.salt}:arm`, user) < 5000 ? 'treatment' : 'control';        // the arm does not depend on the ramp
};

let seed = 7;
const draw = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return (seed >>> 16) % 10000; }; // 0..9999

// Two-proportion z test as z squared (no square root needed), and the chi-square for a 50/50 split.
const zSquared = (n1, c1, n2, c2) => { const p = (c1 + c2) / (n1 + n2), d = c1 / n1 - c2 / n2; return (d * d) / (p * (1 - p) * (1 / n1 + 1 / n2)); };
const srmChi = (a, b) => ((a - b) * (a - b)) / (a + b);
const milli = (x) => { const m = Math.floor(x * 1000 + 0.5); return `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, '0')}`; }; // 3 decimals, formatted by hand so every language prints the same

const users = Array.from({ length: 40000 }, (_, i) => `u${i + 1}`);
console.log(`u1 buckets: arm ${bucket('exp-a:arm', 'u1')}, ramp ${bucket('exp-a:ramp', 'u1')}, layer ${bucket('layer-checkout', 'u1')}`);

// 1. Ramp-up: everyone in at 1% stays in at 5% and 25%, with the same arm.
const expA = { salt: 'exp-a', layer: 'checkout', slice: [0, 5000], ramp: 100 };
const expB = { salt: 'exp-b', layer: 'checkout', slice: [5000, 10000], ramp: 10000 };
const expC = { salt: 'exp-c', layer: 'search', slice: [0, 5000], ramp: 10000 };
let previous = new Map();
for (const ramp of [100, 500, 2500, 10000]) {
  const now = new Map(users.map((u) => [u, assign({ ...expA, ramp }, u)]).filter(([, a]) => a));
  const kept = [...previous].every(([u, a]) => now.get(u) === a);
  console.log(`ramp ${ramp / 100}%: ${now.size} users, earlier users kept their arm: ${kept}`);
  if (!kept) process.exit(1);
  previous = now;
}

// 2. Layers: A and B share a layer, so they never overlap. C is in another layer and overlaps both independently.
let inA = 0, inB = 0, both = 0, inAC = 0, inC = 0;
for (const u of users) {
  const a = assign({ ...expA, ramp: 10000 }, u), b = assign(expB, u), c = assign(expC, u);
  if (a) inA++; if (b) inB++; if (a && b) both++; if (c) inC++; if (a && c) inAC++;
}
console.log(`layer checkout: A ${inA}, B ${inB}, in both ${both}; in A and C ${inAC} of ${inA} (C has ${inC} of ${users.length})`);
if (both !== 0 || Math.abs(inAC / inA - inC / users.length) > 0.02) process.exit(1);

// 3. Outcomes for experiment A at full ramp: control converts at 10.00%, treatment at 11.50%.
let n = [0, 0], c = [0, 0];
for (const u of users) {
  const a = assign({ ...expA, ramp: 10000 }, u); if (!a) continue;
  const k = a === 'treatment' ? 1 : 0; n[k]++; if (draw() < (k ? 1150 : 1000)) c[k]++;
}
const chi = srmChi(n[0], n[1]), z2 = zSquared(n[0], c[0], n[1], c[1]);
console.log(`control ${c[0]}/${n[0]}, treatment ${c[1]}/${n[1]}; sample-ratio chi2 ${milli(chi)} (limit 3.841), z2 ${milli(z2)} (limit 3.841)`);
if (chi > 3.841 || z2 < 3.841) process.exit(1);

// 4. Sample size per arm for a 1 point lift on a 10% rate: 2 * (1.96 + 0.84)^2 * p(1-p) / delta^2, and the days it takes at 2,000 enrolled users a day.
const perArm = Math.ceil((2 * 2.8 * 2.8 * 0.1 * 0.9) / (0.01 * 0.01));
console.log(`needs ${perArm} users per arm, which is ${Math.ceil((2 * perArm) / 2000)} days at 2000 users a day`);

// 5. Peeking: 400 A/A tests (no real difference), 20 looks of 100 users per arm. Stop at the first look past the limit.
let fixedHits = 0, peekHits = 0, boundHits = 0;
for (let t = 0; t < 400; t++) {
  let ca = 0, cb = 0, early = false, bound = false, last = 0;
  for (let look = 1; look <= 20; look++) {
    for (let i = 0; i < 100; i++) { if (draw() < 1000) ca++; if (draw() < 1000) cb++; }
    last = ca + cb > 0 ? zSquared(look * 100, ca, look * 100, cb) : 0;
    if (last > 3.8416) early = true;   // any look past 1.96
    if (last > 9.61) bound = true;     // any look past 3.1, a wider limit that pays for 20 looks
  }
  if (last > 3.8416) fixedHits++; if (early) peekHits++; if (bound) boundHits++;
}
console.log(`false wins in 400 A/A tests: one look at the end ${fixedHits}, stopping at any of 20 looks ${peekHits}, with the wider limit ${boundHits}`);
if (!(peekHits > fixedHits * 2 && boundHits < peekHits)) process.exit(1);
