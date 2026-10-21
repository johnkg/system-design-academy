// A tiny IVF (inverted file) index over 2D points: k-means-lite lists, nprobe search, recall vs brute force.
// Integer maths and a seeded LCG keep the output identical in every language.
const SEED = 12345;
let seed = SEED;
// Park-Miller "minimal standard" LCG (MINSTD): multiplier 48271, modulus 2^31 - 1.
const rnd = () => (seed = (seed * 48271) % 2147483647);

const N = 2000, CLUSTERS = 24, NLIST = 32, K = 10, Q = 40;
const CENTER_MIN = 1000, CENTER_SPREAD = 8000; // cluster centres lie in [1000, 9000)
const JITTER_RANGE = 1600, JITTER_CENTER = (3 * JITTER_RANGE) / 2; // sum of three draws in 0..1600, centred on 0
const KMEANS_ROUNDS = 6;
const ID_SLOTS = 4096; // a candidate packs distance * ID_SLOTS + id; N must stay below it
const FILTER_TAG = 3;
const cx = [], cy = [];
for (let c = 0; c < CLUSTERS; c++) { cx.push((rnd() % CENTER_SPREAD) + CENTER_MIN); cy.push((rnd() % CENTER_SPREAD) + CENTER_MIN); }
const jitter = () => (rnd() % (JITTER_RANGE + 1)) + (rnd() % (JITTER_RANGE + 1)) + (rnd() % (JITTER_RANGE + 1)) - JITTER_CENTER;
const px = [], py = [], tag = [];
for (let i = 0; i < N; i++) { const t = i % CLUSTERS; tag.push(t); px.push(cx[t] + jitter()); py.push(cy[t] + jitter()); }
const qs = [];
for (let i = 0; i < Q; i++) { const t = rnd() % CLUSTERS; qs.push([cx[t] + jitter(), cy[t] + jitter()]); }
const d2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

// Build: Lloyd's k-means for 6 rounds, starting from evenly spaced points.
const mx = [], my = [];
for (let c = 0; c < NLIST; c++) { mx.push(px[Math.floor(c * N / NLIST)]); my.push(py[Math.floor(c * N / NLIST)]); }
const nearest = (x, y) => { let b = 0, bd = d2(x, y, mx[0], my[0]); for (let c = 1; c < NLIST; c++) { const d = d2(x, y, mx[c], my[c]); if (d < bd) { bd = d; b = c; } } return b; };
let assign = [];
for (let it = 0; it < KMEANS_ROUNDS; it++) {
  assign = px.map((x, i) => nearest(x, py[i]));
  const sx = Array(NLIST).fill(0), sy = Array(NLIST).fill(0), n = Array(NLIST).fill(0);
  assign.forEach((c, i) => { sx[c] += px[i]; sy[c] += py[i]; n[c]++; });
  for (let c = 0; c < NLIST; c++) if (n[c] > 0) { mx[c] = Math.floor(sx[c] / n[c]); my[c] = Math.floor(sy[c] / n[c]); }
}
assign = px.map((x, i) => nearest(x, py[i]));
const lists = Array.from({ length: NLIST }, () => []);
assign.forEach((c, i) => lists[c].push(i));

// Search: rank centroids, scan the nprobe closest lists, keep the K best. filter < 0 means no metadata filter.
function search(q, nprobe, filter, all) {
  const order = [...Array(NLIST).keys()].sort((a, b) => d2(q[0], q[1], mx[a], my[a]) - d2(q[0], q[1], mx[b], my[b]) || a - b);
  const cand = []; let work = 0;
  const ids = all ? [...Array(N).keys()] : order.slice(0, nprobe).flatMap((c) => lists[c]);
  for (const i of ids) if (filter < 0 || tag[i] === filter) { work++; cand.push(d2(q[0], q[1], px[i], py[i]) * ID_SLOTS + i); }
  cand.sort((a, b) => a - b);
  return { top: cand.slice(0, K).map((v) => v % ID_SLOTS), work: work + (all ? 0 : NLIST) };
}
function run(nprobe, filter, post) {
  let hits = 0, work = 0, returned = 0;
  for (const q of qs) {
    const truth = new Set(search(q, 0, filter, true).top);
    let r = search(q, nprobe, post ? -1 : filter, false);
    let top = post ? r.top.filter((i) => tag[i] === filter) : r.top;
    work += r.work; returned += top.length; hits += top.filter((i) => truth.has(i)).length;
  }
  return { hits, total: Q * K, avg: Math.floor(work / Q), returned };
}

console.log(`points=${N} lists=${NLIST} sizes=${lists.map((l) => l.length).join(",")}`);
let prev = null;
for (const p of [1, 2, 4, 8, 32]) {
  const r = run(p, -1, false);
  console.log(`nprobe=${p} recall@${K}=${r.hits}/${r.total} (${Math.floor(r.hits * 100 / r.total)}%) distance computations per query=${r.avg} (brute force ${N})`);
  if (prev && (r.hits < prev.hits || r.avg < prev.avg)) process.exit(1);
  prev = r;
}
if (prev.hits !== prev.total) process.exit(1); // probing every list is exact
for (const p of [1, 4, 32]) {
  const pre = run(p, FILTER_TAG, false), post = run(p, FILTER_TAG, true);
  console.log(`filter tag=3 nprobe=${p}: pre-filter recall=${Math.floor(pre.hits * 100 / pre.total)}% post-filter recall=${Math.floor(post.hits * 100 / post.total)}% post-filter results returned=${post.returned}/${post.total}`);
}
// Memory: 10M vectors of 768 dimensions.
const V = 10000000, D = 768, MB = 1000000;
const FLOAT32_BYTES = 4, PQ_BYTES = 96;
console.log(`float32 ${Math.floor(V * D * FLOAT32_BYTES / MB)} MB, int8 ${Math.floor(V * D / MB)} MB, product quantisation (96 bytes per vector) ${Math.floor(V * PQ_BYTES / MB)} MB`);
