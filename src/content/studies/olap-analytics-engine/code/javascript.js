// A tiny OLAP engine in JavaScript: events are rolled up into time-partitioned segments,
// each segment stores dictionary-encoded columns with bitmap indexes, and a query is
// scattered over the segments that can match and the partial sums are merged.

let seed = 7;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };

const COUNTRIES = ['US', 'DE', 'FR', 'JP', 'BR', 'IN'], DEVICES = ['ios', 'web', 'android'];
const WINDOW = 60, BUCKET = 10; // a segment covers 60 minutes, rollup granularity is 10 minutes
const EVENTS = 6000;
const MINUTES = 240; // events fall in the first 4 hours
const MAX_MS = 500; // latency 1..500 ms
const KEY_STEP = 100; // rollup key = bucket * KEY_STEP^2 + country * KEY_STEP + device
const KEY_BUCKET = KEY_STEP * KEY_STEP;
const QUERY_FROM = 60; // the demo query covers minutes 60..179
const QUERY_TO = 180;
const events = [];
for (let i = 0; i < EVENTS; i++) {
  const t = rnd(MINUTES), c = Math.min(rnd(COUNTRIES.length), rnd(COUNTRIES.length)), d = rnd(DEVICES.length), ms = 1 + rnd(MAX_MS); // countries are skewed
  events.push({ t, c, d, ms });
}

// Dictionary encoding: sorted distinct values get small ids; a bitmap per id marks the rows holding it.
function encode(values) {
  const dict = [...new Set(values)].sort();
  const bitmaps = dict.map(() => new Array((values.length + 15) >> 4).fill(0));
  values.forEach((v, row) => { bitmaps[dict.indexOf(v)][row >> 4] |= 1 << (row & 15); });
  return { dict, bitmaps };
}

function buildSegment(start, evs) {
  const acc = new Map(); // rollup: one row per (bucket, country, device) with a count and a sum
  for (const e of evs) {
    const key = Math.floor(e.t / BUCKET) * KEY_BUCKET + e.c * KEY_STEP + e.d;
    const a = acc.get(key) || [0, 0];
    a[0] += 1; a[1] += e.ms; acc.set(key, a);
  }
  const keys = [...acc.keys()].sort((a, b) => a - b);
  const rows = keys.map((k) => ({ bucket: Math.floor(k / KEY_BUCKET) * BUCKET, country: COUNTRIES[Math.floor(k / KEY_STEP) % KEY_STEP], device: DEVICES[k % KEY_STEP], count: acc.get(k)[0], sum: acc.get(k)[1] }));
  return { start, end: start + WINDOW, rows, country: encode(rows.map((r) => r.country)), device: encode(rows.map((r) => r.device)) };
}

const segments = [];
for (let s = 0; s < MINUTES; s += WINDOW) segments.push(buildSegment(s, events.filter((e) => e.t >= s && e.t < s + WINDOW)));
console.log(`raw events: ${events.length}, rolled-up rows: ${segments.reduce((n, s) => n + s.rows.length, 0)} in ${segments.length} segments (${segments.map((s) => s.rows.length).join(', ')})`);
console.log(`segment 1 country dictionary: ${segments[1].country.dict.join(',')}`);

const orBitmaps = (col, names) => { // OR the bitmaps of every wanted value that this segment knows
  const out = new Array(col.bitmaps[0].length).fill(0);
  for (const n of names) { const id = col.dict.indexOf(n); if (id >= 0) col.bitmaps[id].forEach((w, i) => { out[i] |= w; }); }
  return out;
};

// One segment's share of the work: filter with bitmaps, then aggregate only the matching rows.
function scanSegment(seg, from, to, countries, device) {
  const hit = orBitmaps(seg.country, countries).map((w, i) => w & orBitmaps(seg.device, [device])[i]);
  const part = new Map(); let matched = 0;
  seg.rows.forEach((r, row) => {
    if (!((hit[row >> 4] >> (row & 15)) & 1) || r.bucket < from || r.bucket >= to) return;
    const a = part.get(r.bucket) || [0, 0];
    a[0] += r.count; a[1] += r.sum; part.set(r.bucket, a); matched++;
  });
  return { part, matched };
}

function query(from, to, countries, device) { // scatter to segments that overlap the time range, then gather
  const merged = new Map(); let scanned = 0, matched = 0;
  for (const seg of segments) {
    if (seg.end <= from || seg.start >= to) continue; // pruned by time range
    scanned++;
    const res = scanSegment(seg, from, to, countries, device);
    matched += res.matched;
    for (const [b, [c, s]] of res.part) { const a = merged.get(b) || [0, 0]; a[0] += c; a[1] += s; merged.set(b, a); }
  }
  return { merged, scanned, matched };
}

const res = query(QUERY_FROM, QUERY_TO, ['DE', 'FR'], 'ios');
for (const b of [...res.merged.keys()].sort((a, c) => a - c)) console.log(`minute ${b}: ${res.merged.get(b)[0]} events, avg ${Math.floor(res.merged.get(b)[1] / res.merged.get(b)[0])} ms`);
console.log(`segments scanned: ${res.scanned} of ${segments.length}, rolled rows matched: ${res.matched}`);

// The rolled-up answer must equal a brute-force pass over the raw events.
const raw = new Map();
for (const e of events) {
  if (e.t < QUERY_FROM || e.t >= QUERY_TO || e.d !== 0 || (e.c !== 1 && e.c !== 2)) continue;
  const b = Math.floor(e.t / BUCKET) * BUCKET, a = raw.get(b) || [0, 0];
  a[0] += 1; a[1] += e.ms; raw.set(b, a);
}
const same = raw.size === res.merged.size && [...raw].every(([b, a]) => res.merged.get(b) && res.merged.get(b)[0] === a[0] && res.merged.get(b)[1] === a[1]);
console.log(`matches brute force over raw events: ${same}`);
if (!same || res.scanned !== 2) process.exit(1);
