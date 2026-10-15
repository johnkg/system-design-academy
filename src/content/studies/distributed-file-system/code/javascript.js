// A tiny GFS-style cluster in JavaScript: a master with a chunk map, rack-aware placement,
// heartbeats that detect dead servers, prioritised re-replication, and checksum scrubbing.
const RACKS = 6, PER = 3, N = RACKS * PER, CHUNKS = 40, BLOCKS = 4, COPY_BUDGET = 4, TIMEOUT = 3;
let seed = 7;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const mix = (x) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const rack = (n) => Math.floor(n / PER);

// Chunkservers: each holds chunk id -> { data (block values), sums (checksum per block) }.
const store = Array.from({ length: N }, () => new Map());
const alive = new Array(N).fill(true), lastBeat = new Array(N).fill(0), declaredDead = new Array(N).fill(false);
const replicas = Array.from({ length: CHUNKS }, () => []); // the master's chunk map: chunk -> server list

const pickNode = (ok) => { for (;;) { const n = rnd(N); if (alive[n] && !declaredDead[n] && ok(n)) return n; } };
function writeReplica(c, n, data) { store[n].set(c, { data: data.slice(), sums: data.map(mix) }); replicas[c].push(n); }
const original = (c) => Array.from({ length: BLOCKS }, (_, b) => c * 100 + b + 1);

function place(c) { // first anywhere, second in another rack, third beside the second
  const a = pickNode(() => true);
  const b = pickNode((n) => rack(n) !== rack(a));
  const d = pickNode((n) => rack(n) === rack(b) && n !== b);
  [a, b, d].forEach((n) => writeReplica(c, n, original(c)));
}

const liveReplicas = (c) => replicas[c].filter((n) => !declaredDead[n]); // the master's view: it only knows what heartbeats told it
const racksOf = (c) => new Set(liveReplicas(c).map(rack)).size;

function reReplicate(budget) { // fewest surviving copies first, so the most endangered chunks are fixed first
  const queue = [];
  for (let c = 0; c < CHUNKS; c++) { const k = liveReplicas(c).length; if (k > 0 && k < 3) queue.push([k, c]); }
  queue.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let done = 0;
  for (const [, c] of queue.slice(0, budget)) {
    const src = liveReplicas(c).find((n) => alive[n]), held = replicas[c];
    const target = pickNode((n) => !held.includes(n) && (racksOf(c) > 1 || rack(n) !== rack(src)));
    writeReplica(c, target, store[src].get(c).data); done++;
  }
  return done;
}

const underReplicated = () => { let k = 0; for (let c = 0; c < CHUNKS; c++) if (liveReplicas(c).length < 3) k++; return k; };
for (let c = 0; c < CHUNKS; c++) place(c);
console.log(`placed ${CHUNKS} chunks, ${CHUNKS * 3} replicas, every chunk on 2+ racks: ${[...Array(CHUNKS).keys()].every((c) => racksOf(c) >= 2)}`);

let minCopies = 3, healthyAt = -1;
for (let tick = 1; tick <= 30; tick++) {
  if (tick === 5) alive[4] = false;                    // one server dies
  if (tick === 12) [6, 7, 8].forEach((n) => (alive[n] = false)); // then a whole rack
  for (let n = 0; n < N; n++) if (alive[n]) lastBeat[n] = tick; // heartbeats
  for (let n = 0; n < N; n++) if (!declaredDead[n] && tick - lastBeat[n] > TIMEOUT) { declaredDead[n] = true; console.log(`tick ${tick}: server ${n} declared dead, ${underReplicated()} chunks under-replicated`); }
  for (let c = 0; c < CHUNKS; c++) minCopies = Math.min(minCopies, liveReplicas(c).length);
  const copied = reReplicate(COPY_BUDGET);
  if (copied) console.log(`tick ${tick}: copied ${copied}, ${underReplicated()} still under-replicated`);
  if (tick > 16 && healthyAt < 0 && underReplicated() === 0) healthyAt = tick;
}
console.log(`fewest copies of any chunk: ${minCopies}; fully replicated again at tick ${healthyAt}`);

const sound = (r) => r.data.every((v, b) => mix(v) === r.sums[b]);
let corrupted = 0, found = 0, repaired = 0;
for (let i = 0; i < 5; i++) { // bit rot: flip a value in a stored block, leaving the stored checksum alone
  const c = rnd(CHUNKS), n = liveReplicas(c)[rnd(3)], r = store[n].get(c);
  if (!sound(r)) { i--; continue; }                    // pick another replica if this one is already damaged
  r.data[rnd(BLOCKS)] ^= 1; corrupted++;
}
for (let n = 0; n < N; n++) { // scrub: recompute every block checksum on every live server
  if (!alive[n]) continue;
  for (const [c, r] of [...store[n]]) {
    if (sound(r)) continue;
    found++; store[n].delete(c); replicas[c] = replicas[c].filter((x) => x !== n);
  }
}
while (underReplicated() > 0) repaired += reReplicate(COPY_BUDGET);
console.log(`corrupted ${corrupted}, scrub found ${found}, repaired ${repaired}`);

let clean = true;
for (let c = 0; c < CHUNKS; c++) for (const n of liveReplicas(c)) clean = clean && sound(store[n].get(c)) && store[n].get(c).data.every((v, b) => v === original(c)[b]);
const ok = clean && underReplicated() === 0 && minCopies >= 1 && found === corrupted && [...Array(CHUNKS).keys()].every((c) => racksOf(c) >= 2 && liveReplicas(c).length === 3);
console.log(`all replicas verify, 3 copies on 2+ racks: ${ok}`);
if (!ok) process.exit(1);
