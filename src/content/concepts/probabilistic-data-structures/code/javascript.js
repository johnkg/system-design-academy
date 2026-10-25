// Probabilistic data structures for a web crawler: a Bloom filter for "seen this URL?", HyperLogLog for "how many distinct
// URLs did the shards find?" and a count-min sketch for "which hosts get the most links?". Deterministic: fixed hashes, no randomness.
const N_URLS = 10000, TEST_URLS = 20000, TARGET_FP = 0.01, URL_BYTES = 100;
const HLL_BITS = 14, SHARDS = 4, DISTINCT = 200000;
const CM_ROWS = 4, CM_WIDTH = 272, HOSTS = 1000, TOP_LINKS = 20000; // width = e / 0.01, so the error is at most 1% of all links
const GOLDEN = 0x9e3779b9;

// 32-bit FNV-1a over the URL's characters (all ASCII), then the MurmurHash3 finalizer to spread the bits.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
function fmix(h) {
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const hashI = (h, i) => fmix((h + Math.imul(i + 1, GOLDEN)) >>> 0); // the i-th of several hashes of one key
const url = (i) => `https://site${i % 500}.example/page/${i}`;
const pct = (x) => (100 * x).toFixed(2) + "%";

// --- Bloom filter: m bits, k hashes. "Definitely new" if any bit is 0, "probably seen" if all are 1.
class Bloom {
  constructor(m, k) { this.m = m; this.k = k; this.bits = new Uint8Array(m); }
  add(key) { const h = fnv1a(key); for (let i = 0; i < this.k; i++) this.bits[hashI(h, i) % this.m] = 1; }
  mightContain(key) {
    const h = fnv1a(key);
    for (let i = 0; i < this.k; i++) if (!this.bits[hashI(h, i) % this.m]) return false; // a 0 bit: never added
    return true;
  }
}
function bloomRun(n, m, k) {
  const f = new Bloom(m, k);
  for (let i = 0; i < n; i++) f.add(url(i));
  let fn = 0, fp = 0;
  for (let i = 0; i < n; i++) if (!f.mightContain(url(i))) fn++;
  for (let i = 0; i < TEST_URLS; i++) if (f.mightContain(url(1000000 + i))) fp++; // URLs that were never added
  return { fn, fp, formula: Math.pow(1 - Math.exp((-k * n) / m), k) };
}
const m = Math.ceil((-N_URLS * Math.log(TARGET_FP)) / (Math.LN2 * Math.LN2)); // m = -n ln p / (ln 2)^2
const k = Math.round((m / N_URLS) * Math.LN2); // k = (m / n) ln 2
const b = bloomRun(N_URLS, m, k);
console.log(`Bloom filter: ${N_URLS} URLs, m=${m} bits (${Math.ceil(m / 8)} bytes, ${(m / N_URLS).toFixed(2)} bits per URL), k=${k}`);
console.log(`  exact set would be about ${N_URLS * URL_BYTES} bytes (${URL_BYTES} bytes per URL)`);
console.log(`  false negatives: ${b.fn} of ${N_URLS} inserted URLs`);
console.log(`  false positives: ${b.fp} of ${TEST_URLS} new URLs = ${pct(b.fp / TEST_URLS)} (formula ${pct(b.formula)})`);
const over = bloomRun(2 * N_URLS, m, k); // same size, twice the planned URLs
console.log(`  overfilled with ${2 * N_URLS} URLs: false positives ${pct(over.fp / TEST_URLS)} (formula ${pct(over.formula)})`);

// --- HyperLogLog: 2^14 registers; each keeps the longest run of leading zeros (plus one) among the hashes routed to it.
class HLL {
  constructor(p) { this.p = p; this.m = 1 << p; this.reg = new Uint8Array(this.m); }
  add(key) {
    const h = fmix(fnv1a(key) ^ 0x5bd1e995);
    const j = h >>> (32 - this.p); // the first p bits pick the register
    const rest = (h << this.p) >>> 0;
    const rank = Math.min(Math.clz32(rest) + 1, 32 - this.p + 1);
    if (rank > this.reg[j]) this.reg[j] = rank;
  }
  merge(other) { for (let j = 0; j < this.m; j++) if (other.reg[j] > this.reg[j]) this.reg[j] = other.reg[j]; } // max per register
  estimate() {
    const m = this.m, alpha = 0.7213 / (1 + 1.079 / m);
    let sum = 0, zeros = 0;
    for (let j = 0; j < m; j++) { sum += Math.pow(2, -this.reg[j]); if (this.reg[j] === 0) zeros++; }
    let e = (alpha * m * m) / sum;
    if (e <= 2.5 * m && zeros > 0) e = m * Math.log(m / zeros); // small counts: linear counting
    return Math.round(e);
  }
}
const shards = Array.from({ length: SHARDS }, () => new HLL(HLL_BITS));
for (let i = 0; i < DISTINCT; i++) {
  shards[i % SHARDS].add(url(i));
  if (i % 3 === 0) shards[(i + 1) % SHARDS].add(url(i)); // a third of the URLs are also found by a second shard
}
console.log(`HyperLogLog: ${1 << HLL_BITS} registers, ${((1 << HLL_BITS) * 6) / 8} bytes each, standard error ${pct(1.04 / Math.sqrt(1 << HLL_BITS))}`);
let sumOfShards = 0;
shards.forEach((s, i) => { const e = s.estimate(); sumOfShards += e; console.log(`  shard ${i + 1}: about ${e} distinct URLs`); });
console.log(`  adding the shard counts: ${sumOfShards} (URLs found by two shards are counted twice)`);
const merged = new HLL(HLL_BITS);
shards.forEach((s) => merged.merge(s));
const est = merged.estimate();
console.log(`  merged sketch: ${est}, true ${DISTINCT}, error ${pct((est - DISTINCT) / DISTINCT)}`);

// --- Count-min sketch: CM_ROWS rows of CM_WIDTH counters, one hash per row. The estimate is the smallest counter.
const cm = Array.from({ length: CM_ROWS }, () => new Array(CM_WIDTH).fill(0));
const host = (j) => `host${j}.example`;
const trueLinks = (j) => Math.floor(TOP_LINKS / (j + 1)); // a few hosts get most links (a Zipf-like spread)
let total = 0;
for (let j = 0; j < HOSTS; j++) {
  const h = fnv1a(host(j)), c = trueLinks(j);
  for (let r = 0; r < CM_ROWS; r++) cm[r][hashI(h, r) % CM_WIDTH] += c; // same as adding 1 per link, c times
  total += c;
}
const cmEstimate = (name) => { const h = fnv1a(name); let best = Infinity; for (let r = 0; r < CM_ROWS; r++) best = Math.min(best, cm[r][hashI(h, r) % CM_WIDTH]); return best; };
console.log(`Count-min: ${CM_ROWS} rows x ${CM_WIDTH} counters, ${total} links, error bound 1% of links = ${Math.floor(total / 100)}`);
let under = 0, maxOver = 0;
for (let j = 0; j < HOSTS; j++) { const d = cmEstimate(host(j)) - trueLinks(j); if (d < 0) under++; if (d > maxOver) maxOver = d; }
for (const j of [0, 1, 2, 999]) console.log(`  ${host(j)}: true ${trueLinks(j)}, estimate ${cmEstimate(host(j))}`);
console.log(`  underestimates: ${under}, largest overestimate: ${maxOver}`);
