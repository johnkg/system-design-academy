// A small IVF (inverted file) vector index in JavaScript:
// k-means splits the vectors into lists, a query scans only the nearest lists, and we measure recall against an exact scan.
const DIM = 8, N = 2000, LISTS = 16, K = 10, QUERIES = 50;

const SEED = 7, CLUSTERS = 24, KMEANS_ROUNDS = 5, FILTER_NPROBE = 2;
const MAX_COMPONENT = 255, NOISE = 60; // components are bytes; a vector sits within +-60 of its cluster centre
const SALE_EVERY = 10;                 // 10% of vectors carry the filter tag
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), top 24 bits.
const rand = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };

const dist = (a, b) => { let s = 0; for (let i = 0; i < DIM; i++) s += (a[i] - b[i]) ** 2; return s; }; // squared distance, integers only
const clamp = (x) => Math.min(MAX_COMPONENT, Math.max(0, x));
const near = (c) => c.map((x) => clamp(x + rand(2 * NOISE + 1) - NOISE));

const centers = Array.from({ length: CLUSTERS }, () => Array.from({ length: DIM }, () => rand(MAX_COMPONENT + 1)));
const vectors = Array.from({ length: N }, () => near(centers[rand(CLUSTERS)]));
const tags = vectors.map((_, id) => (id % SALE_EVERY === 0 ? 'sale' : 'other')); // 10% of vectors carry the filter tag

// Training: a few rounds of k-means with integer centroids.
let cents = Array.from({ length: LISTS }, (_, i) => vectors[i * (N / LISTS)].slice());
const closest = (v, list) => list.reduce((best, c, i) => (dist(v, c) < dist(v, list[best]) ? i : best), 0);
for (let round = 0; round < KMEANS_ROUNDS; round++) {
  const sums = cents.map(() => new Array(DIM).fill(0)), counts = new Array(LISTS).fill(0);
  for (const v of vectors) { const c = closest(v, cents); counts[c]++; v.forEach((x, i) => (sums[c][i] += x)); }
  cents = cents.map((old, c) => (counts[c] ? sums[c].map((s) => Math.floor(s / counts[c])) : old));
}
const lists = Array.from({ length: LISTS }, () => []);
vectors.forEach((v, id) => lists[closest(v, cents)].push(id));

const hundredths = (n) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`; // 2 decimals without float formatting
const byDistance = (a, b) => a[0] - b[0] || a[1] - b[1];
function search(q, nprobe, accept = () => true) {
  const order = cents.map((c, i) => [dist(q, c), i]).sort(byDistance).slice(0, nprobe).map((e) => e[1]);
  const hits = []; let scanned = 0;
  for (const l of order) for (const id of lists[l]) { scanned++; if (accept(id)) hits.push([dist(q, vectors[id]), id]); }
  return { ids: hits.sort(byDistance).slice(0, K).map((h) => h[1]), scanned };
}
const exact = (q, accept = () => true) => vectors.map((v, id) => [dist(q, v), id]).filter((e) => accept(e[1])).sort(byDistance).slice(0, K).map((e) => e[1]);

const queries = Array.from({ length: QUERIES }, () => near(vectors[rand(N)]));
const onSale = (id) => tags[id] === 'sale';
console.log(`lists hold ${Math.min(...lists.map((l) => l.length))} to ${Math.max(...lists.map((l) => l.length))} vectors`);
let last = 0;
for (const nprobe of [1, 2, 4, 8, 16]) {
  let found = 0, scanned = 0;
  for (const q of queries) { const r = search(q, nprobe), truth = exact(q); found += r.ids.filter((id) => truth.includes(id)).length; scanned += r.scanned; }
  const recall = Math.floor((found * 100) / (QUERIES * K));
  console.log(`nprobe ${nprobe}: recall@${K} ${recall}%, scans ${Math.floor(scanned / QUERIES)} of ${N} vectors`);
  if (recall < last) process.exit(1);
  last = recall;
}
if (last !== 100) process.exit(1);

let post = 0, during = 0, duringHits = 0;
for (const q of queries) {
  post += search(q, FILTER_NPROBE).ids.filter(onSale).length;                       // filter after the search: only what is left of the top 10
  const r = search(q, FILTER_NPROBE, onSale); during += r.ids.length;               // filter while scanning: the top 10 of the matching vectors
  const truth = exact(q, onSale); duringHits += r.ids.filter((id) => truth.includes(id)).length;
}
console.log(`filter 'sale' (10%), nprobe 2: after the search ${hundredths(Math.floor((post * 100) / QUERIES))} results on average, during the scan ${hundredths(Math.floor((during * 100) / QUERIES))}`);
console.log(`filtered recall ${Math.floor((duringHits * 100) / during)}%`);
if (post >= during) process.exit(1);
