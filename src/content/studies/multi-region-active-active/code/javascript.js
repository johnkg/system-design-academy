// Three active-active regions in JavaScript:
// a last-writer-wins register loses concurrent increments and obeys a skewed clock, while a counter CRDT merges to the exact total.

const SKEW = [0, 2, -3]; // each region's wall clock is a little off
const REGIONS = SKEW.length;
const STEPS = 600;
const REPLICATE_ONE_IN = 4; // a replication round on one step in 4
let seed = 7;
const rand = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };

// Last-writer-wins: the higher timestamp wins, and the higher region id breaks a tie.
const lwwWins = (a, b) => a.ts > b.ts || (a.ts === b.ts && a.region > b.region);
const lwwMerge = (mine, theirs) => (lwwWins(theirs, mine) ? { ...theirs } : mine);

class Region {
  constructor(id) {
    this.id = id;
    this.likes = { value: 0, ts: 0, region: id }; // likes kept as one LWW register
    this.counts = [0, 0, 0];                      // likes kept as a G-counter: one slot per region
    this.name = { value: "none", ts: 0, region: id };
  }
  clock(step) { return step + SKEW[this.id]; }
  like(step) {
    this.likes = { value: this.likes.value + 1, ts: this.clock(step), region: this.id }; // read, add one, write back
    this.counts[this.id]++;
  }
  rename(step, value) { this.name = { value, ts: this.clock(step), region: this.id }; }
  mergeFrom(other) { // replication: apply the other region's state
    this.likes = lwwMerge(this.likes, other.likes);
    this.name = lwwMerge(this.name, other.name);
    this.counts = this.counts.map((c, i) => Math.max(c, other.counts[i]));
  }
  total() { return this.counts.reduce((a, b) => a + b, 0); }
}

const regions = Array.from({ length: REGIONS }, (_, id) => new Region(id));
let truth = 0;
for (let step = 1; step <= STEPS; step++) {
  const r = rand(REGIONS);
  regions[r].like(step);
  truth++;
  if (step === 100) regions[0].rename(step, "alice-old");
  if (step === 101) regions[2].rename(step, "alice-new"); // really later, but region 2's clock runs 3 behind
  if (rand(REPLICATE_ONE_IN) === 0) { // lazy replication between random pairs
    const src = rand(REGIONS), dst = (src + 1 + rand(REGIONS - 1)) % REGIONS;
    regions[dst].mergeFrom(regions[src]);
  }
}

console.log(`likes really given: ${truth}`);
console.log(`before sync, LWW likes per region: ${regions.map((r) => r.likes.value).join(", ")}`);
console.log(`before sync, CRDT likes per region: ${regions.map((r) => r.total()).join(", ")}`);

for (let round = 0; round < 2; round++) // anti-entropy: every pair exchanges state
  for (const a of regions) for (const b of regions) if (a !== b) a.mergeFrom(b);

const lww = regions.map((r) => r.likes.value);
const crdt = regions.map((r) => r.total());
console.log(`after sync, LWW likes: ${lww.join(", ")} (lost ${truth - lww[0]})`);
console.log(`after sync, CRDT likes: ${crdt.join(", ")} (lost ${truth - crdt[0]})`);
console.log(`name everywhere: ${regions.map((r) => r.name.value).join(", ")}`);

const converged = new Set(lww).size === 1 && new Set(crdt).size === 1 && new Set(regions.map((r) => r.name.value)).size === 1;
console.log(`converged: ${converged}`);
if (!converged || crdt[0] !== truth || lww[0] >= truth || regions[0].name.value !== "alice-old") process.exit(1);
