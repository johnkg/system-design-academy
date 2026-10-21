// An error tracking ingest path in JavaScript:
// a per-project token bucket, fingerprinting by in-app stack frames, grouping, and regression detection.

const fnv1a = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
const hex = (h) => h.toString(16).padStart(8, '0');
const normalize = (m) => m.replace(/[0-9]+/g, '#'); // ids and counts in a message must not split a group

// [file, function, line in release 0]. A template with no frames is a message-only error.
const TEMPLATES = [
  { type: 'TypeError', msg: 'cannot read price of item', frames: [['cart.js', 'priceOf', 40], ['cart.js', 'total', 12], ['view.js', 'render', 88]] },
  { type: 'RangeError', msg: 'invalid page index', frames: [['list.js', 'slice', 7], ['list.js', 'paginate', 31]] },
  { type: 'CheckoutError', msg: 'card declined for order', frames: [['pay.js', 'charge', 55], ['checkout.js', 'submit', 19]] },
  { type: 'KeyError', msg: 'missing field user', frames: [['api.js', 'parse', 23], ['api.js', 'handle', 64]] },
  { type: 'TimeoutError', msg: 'no reply after 30 s from host 10.0.0.', frames: [] },
];
const WEIGHTS = [0, 0, 0, 1, 1, 1, 2, 2, 3, 4];

const ID_MIN = 1000; // messages carry a 4-digit id
const ID_SPREAD = 9000;
const VENDOR_FNS = 3; // vendor frames run0..run2
const VENDOR_LINE = 300;
const LINE_SHIFT = 7; // app frame lines move this much every release
const FINGERPRINT_FRAMES = 3; // top app frames in a fingerprint
const TICKS = 300;
const RELEASE_TICKS = 100; // a new release every 100 ticks
const STORM_START = 100; // the api retry storm: 20 events per tick for 20 ticks
const STORM_TICKS = 20;
const STORM_EVENTS = 20;
const TOP_GROUPS = 4;
const BUCKET_CAPACITY = 30; // per-project token bucket
const BUCKET_REFILL = 3; // tokens added per tick

let seed = 7;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };

function makeEvent(release) {
  let idx = WEIGHTS[rnd(WEIGHTS.length)];
  if (release === 1 && idx === 2) idx = 1; // the checkout bug is fixed in release 1
  const t = TEMPLATES[idx], num = rnd(ID_SPREAD) + ID_MIN, vendor = rnd(VENDOR_FNS);
  const frames = t.frames.map(([file, fn, line]) => ({ file, fn, line: line + release * LINE_SHIFT, app: true })); // lines move every release
  if (frames.length) frames.push({ file: 'vendor.js', fn: 'run' + vendor, line: VENDOR_LINE + vendor, app: false });
  return { type: t.type, message: `${t.msg} ${num}`, frames, release };
}

function fingerprint(e) {
  const app = e.frames.filter((f) => f.app).slice(0, FINGERPRINT_FRAMES).map((f) => `${f.file}:${f.fn}`).join('>');
  return fnv1a(`${e.type}|${app || normalize(e.message)}`); // no line numbers, no vendor frames
}
const naiveKey = (e) => fnv1a(`${e.type}|${e.message}|` + e.frames.map((f) => `${f.file}:${f.fn}:${f.line}`).join('>'));

class Bucket {
  constructor(cap, refill) { this.cap = cap; this.refill = refill; this.tokens = cap; }
  tick() { this.tokens = Math.min(this.cap, this.tokens + this.refill); }
  take() { if (this.tokens < 1) return false; this.tokens--; return true; }
}

const projects = { web: { bucket: new Bucket(BUCKET_CAPACITY, BUCKET_REFILL), sent: 0, kept: 0 }, api: { bucket: new Bucket(BUCKET_CAPACITY, BUCKET_REFILL), sent: 0, kept: 0 } };
const groups = new Map(), naive = new Set(), regressions = [];

for (let t = 0; t < TICKS; t++) {
  const release = t < RELEASE_TICKS ? 0 : t < 2 * RELEASE_TICKS ? 1 : 2;
  if (t === RELEASE_TICKS) for (const g of groups.values()) if (g.title.startsWith('CheckoutError')) g.status = 'resolved';
  for (const [name, p] of Object.entries(projects)) {
    p.bucket.tick();
    const n = name === 'api' && t >= STORM_START && t < STORM_START + STORM_TICKS ? STORM_EVENTS : 1; // a retry storm in the api project
    for (let i = 0; i < n; i++) {
      const e = makeEvent(release);
      p.sent++;
      if (!p.bucket.take()) continue; // over the project quota: dropped
      p.kept++;
      naive.add(naiveKey(e));
      const key = `${name}:${hex(fingerprint(e))}`;
      let g = groups.get(key);
      if (!g) { g = { title: `${e.type}: ${normalize(e.message)}`, count: 0, status: 'open' }; groups.set(key, g); }
      else if (g.status === 'resolved') { g.status = 'regressed'; regressions.push(`${key} at t=${t} in release ${e.release}`); }
      g.count++;
    }
  }
}

const sent = projects.web.sent + projects.api.sent, kept = projects.web.kept + projects.api.kept;
console.log(`events sent ${sent}, kept ${kept}, dropped ${sent - kept}`);
for (const [name, p] of Object.entries(projects)) console.log(`${name}: sent ${p.sent}, kept ${p.kept}, dropped ${p.sent - p.kept}`);
console.log(`distinct events by naive key ${naive.size}, groups by fingerprint ${groups.size}`);
const ranked = [...groups].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
for (const [key, g] of ranked.slice(0, TOP_GROUPS)) console.log(`${key} x${g.count} [${g.status}] ${g.title}`);
console.log(`regressions: ${regressions.length ? regressions.join('; ') : 'none'}`);

const total = [...groups.values()].reduce((s, g) => s + g.count, 0);
if (total !== kept || groups.size >= naive.size || regressions.length === 0) process.exit(1);
