// A tiny time-series database in JavaScript:
// Gorilla compression (delta-of-delta timestamps, XOR floats) plus an inverted index from labels to series ids.

const view = new DataView(new ArrayBuffer(8));
const toBits = (x) => { view.setFloat64(0, x); return view.getBigUint64(0); };
const fromBits = (b) => { view.setBigUint64(0, b); return view.getFloat64(0); };
const bitLength = (x) => x.toString(2).length;
const trailing = (x) => { let t = 0; while (((x >> BigInt(t)) & 1n) === 0n) t++; return t; };

class BitWriter {
  constructor() { this.bits = []; }
  put(value, n) { const v = BigInt(value); for (let i = n - 1; i >= 0; i--) this.bits.push(Number((v >> BigInt(i)) & 1n)); }
}
class BitReader {
  constructor(bits) { this.bits = bits; this.pos = 0; }
  get(n) { let v = 0n; for (let i = 0; i < n; i++) v = (v << 1n) | BigInt(this.bits[this.pos++]); return v; }
}

// A delta-of-delta fits one of three small buckets (tag, number of bits), or falls back to 32 bits.
const BUCKETS = [{ tag: 0b10, tagBits: 2, bits: 7 }, { tag: 0b110, tagBits: 3, bits: 9 }, { tag: 0b1110, tagBits: 4, bits: 12 }];
const bias = (bits) => 2 ** (bits - 1) - 1;

function putDod(w, d) {
  if (d === 0) return w.put(0, 1); // a steady scrape interval costs one bit
  for (const b of BUCKETS) if (d >= -bias(b.bits) && d <= bias(b.bits) + 1) { w.put(b.tag, b.tagBits); w.put(d + bias(b.bits), b.bits); return; }
  w.put(0b1111, 4); w.put(d + 2 ** 31, 32);
}
function getDod(r) {
  if (r.get(1) === 0n) return 0;
  let k = 0;
  while (k < 3 && r.get(1) === 1n) k++;
  if (k === 3) return Number(r.get(32)) - 2 ** 31;
  return Number(r.get(BUCKETS[k].bits)) - bias(BUCKETS[k].bits);
}

function compress(points) {
  const w = new BitWriter();
  w.put(points[0][0], 32); w.put(toBits(points[0][1]), 64);
  let prevT = points[0][0], prevDelta = 0, prev = toBits(points[0][1]), lead = -1, len = 0;
  for (const [t, v] of points.slice(1)) {
    putDod(w, t - prevT - prevDelta); prevDelta = t - prevT; prevT = t;
    const bits = toBits(v), x = bits ^ prev; prev = bits;
    if (x === 0n) { w.put(0, 1); continue; }  // same value as before: one bit
    const l = Math.min(64 - bitLength(x), 31), tz = trailing(x);
    if (lead >= 0 && l >= lead && tz >= 64 - lead - len) { w.put(0b10, 2); w.put(x >> BigInt(64 - lead - len), len); } // fits the previous window
    else { const m = 64 - l - tz; w.put(0b11, 2); w.put(l, 5); w.put(m - 1, 6); w.put(x >> BigInt(tz), m); lead = l; len = m; }
  }
  return w.bits;
}

function decompress(bits, n) {
  const r = new BitReader(bits), out = [];
  let t = Number(r.get(32)), prev = r.get(64), delta = 0, lead = 0, len = 0;
  out.push([t, fromBits(prev)]);
  while (out.length < n) {
    delta += getDod(r); t += delta;
    if (r.get(1) === 1n) {
      if (r.get(1) === 1n) { lead = Number(r.get(5)); len = Number(r.get(6)) + 1; }
      prev ^= r.get(len) << BigInt(64 - lead - len);
    }
    out.push([t, fromBits(prev)]);
  }
  return out;
}

// The inverted index: "label=value" -> sorted list of series ids. A query intersects the lists.
const series = [], postings = new Map(), blocks = [];
function addSeries(labels, points) {
  const id = series.length; series.push(labels);
  for (const [k, v] of Object.entries(labels)) { const key = `${k}=${v}`; if (!postings.has(key)) postings.set(key, []); postings.get(key).push(id); }
  blocks.push({ n: points.length, bits: compress(points) });
}
function intersect(a, b) {
  const out = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; }
  return out;
}
const select = (matchers) => matchers.map((m) => postings.get(m) ?? []).sort((a, b) => a.length - b.length).reduce(intersect);

const SERIES = 8; // hosts h0..h7
const POINTS = 120; // points per series
const BASE_VALUE = 50; // host h starts at 50 + h
const VALUE_STEP = 0.25; // a changing scrape moves the value by one step
const SCRAPE_S = 10; // seconds between scrapes
const JITTER_ONE_IN = 8; // one scrape in 8 lands a second late
const WEB_HOSTS = 5; // h0..h4 are web, the rest db
const QUERY_FROM = 300; // the range query covers T0+300 .. T0+599
const QUERY_TO = 600;
const MAX_BITS_PER_POINT = 40; // compression must do better than this

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const T0 = 1700000000, raw = [];
for (let h = 0; h < SERIES; h++) {
  let v = BASE_VALUE + h; const points = [];
  for (let i = 0; i < POINTS; i++) {
    if (random(2) === 0) v += (random(3) - 1) * VALUE_STEP; // half the scrapes see no change
    points.push([T0 + i * SCRAPE_S + (random(JITTER_ONE_IN) === 0 ? 1 : 0), v]);
  }
  raw.push(points);
  addSeries({ __name__: 'cpu', host: `h${h}`, region: h % 2 === 0 ? 'eu' : 'us', tier: h < WEB_HOSTS ? 'web' : 'db' }, points);
}

const total = blocks.reduce((s, b) => s + b.bits.length, 0), count = raw.length * POINTS;
console.log(`${series.length} series, ${count} points, raw ${count * 16} bytes`);
console.log(`compressed ${blocks.reduce((s, b) => s + Math.ceil(b.bits.length / 8), 0)} bytes, ${(total / count).toFixed(2)} bits per point`);
const ok = blocks.every((b, i) => JSON.stringify(decompress(b.bits, b.n)) === JSON.stringify(raw[i]));
console.log(`round trip exact: ${ok}`);

const ids = select(['__name__=cpu', 'region=eu', 'tier=web']);
console.log(`region=eu has [${postings.get('region=eu')}]; cpu, eu and web match series [${ids}]`);
let sum = 0, hits = 0;
for (const id of ids) for (const [t, v] of decompress(blocks[id].bits, blocks[id].n)) if (t >= T0 + QUERY_FROM && t < T0 + QUERY_TO) { sum += v; hits++; }
console.log(`points in the range: ${hits}, sum ${sum.toFixed(2)}`);
if (!ok || ids.join() !== '0,2,4' || total / count > MAX_BITS_PER_POINT) process.exit(1);
