// Trace context and a tail sampler in JavaScript:
// spans carry a W3C traceparent, arrive out of order, and a sampler buffers each trace for a wait before deciding to keep or drop it.

const formatTraceparent = (traceId, spanId, sampled) => `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
function parseTraceparent(header) {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header);
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null; // all-zero ids are invalid
  return { traceId: m[1], spanId: m[2], sampled: (parseInt(m[3], 16) & 1) === 1 };
}

let seed = 77;
const nextU32 = () => (seed = (seed * 1664525 + 1013904223) % 4294967296);
const next = (n) => Math.floor(nextU32() / 65536) % n;
const hex = (n, width) => n.toString(16).padStart(width, '0');

// 400 traces. About 4% fail and 6% are slow; 10% have an async span that ends long after the root span.
function makeTraces() {
  const traces = [], events = [];
  for (let i = 0; i < 400; i++) {
    const start = i * 10 + next(10);
    const traceId = [0, 1, 2, 3].map(() => hex(nextU32(), 8)).join('');
    const kind = next(100), n = 3 + next(5);
    const rootDur = kind < 4 ? 30 + next(200) : kind < 10 ? 800 + next(1200) : 20 + next(80);
    const errAt = kind < 4 ? 1 + next(n - 1) : -1;
    traces.push({ traceId, n, bad: kind < 10 });
    for (let k = 0; k < n; k++) {
      let off = 0, dur = rootDur;
      if (k > 0) { off = next(Math.floor(rootDur / 2) + 1); dur = 1 + next(Math.max(1, rootDur - off)); }
      if (k > 0 && next(100) < 10) off += 1000 + next(3000); // async span, ends after the root
      const arrival = start + off + dur + 5 + next(120);
      events.push({ arrival, traceId, root: k === 0, dur, err: k === errAt });
    }
  }
  events.sort((a, b) => a.arrival - b.arrival);
  return { traces, events };
}

class TailSampler {
  constructor(wait) { this.wait = wait; this.open = new Map(); this.decided = new Set(); this.kept = new Map(); this.late = 0; this.peak = 0; }
  decide(t) {
    this.open.delete(t.id);
    const slow = t.spans.some((s) => s.root && s.dur >= 500), error = t.spans.some((s) => s.err);
    const baseline = parseInt(t.id.slice(0, 8), 16) % 100 < 2; // keep 2% of ordinary traces
    this.decided.add(t.id);
    if (slow || error || baseline) this.kept.set(t.id, t.spans.length);
  }
  flush(now) { for (const t of [...this.open.values()]) if (t.deadline <= now) this.decide(t); } // oldest first
  add(e) {
    this.flush(e.arrival);
    if (this.decided.has(e.traceId)) { this.late++; return; } // too late: this span is dropped
    if (!this.open.has(e.traceId)) this.open.set(e.traceId, { id: e.traceId, deadline: e.arrival + this.wait, spans: [] });
    this.open.get(e.traceId).spans.push(e);
    this.peak = Math.max(this.peak, this.open.size);
  }
  finish() { this.flush(Infinity); }
}

const root = parseTraceparent(formatTraceparent('4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7', true));
console.log(`traceparent round trip: trace ${root.traceId.slice(0, 8)}, sampled ${root.sampled}, invalid rejected ${parseTraceparent('00-' + '0'.repeat(32) + '-00f067aa0ba902b7-01') === null}`);

const { traces, events } = makeTraces();
const bad = traces.filter((t) => t.bad);
console.log(`${traces.length} traces, ${events.length} spans, ${bad.length} slow or failed`);
const results = {};
for (const wait of [100, 1000, 10000]) {
  const s = new TailSampler(wait);
  events.forEach((e) => s.add(e));
  s.finish();
  const badKept = bad.filter((t) => s.kept.has(t.traceId)).length;
  const incomplete = traces.filter((t) => s.kept.has(t.traceId) && s.kept.get(t.traceId) < t.n).length;
  results[wait] = { badKept, incomplete, peak: s.peak };
  console.log(`wait ${wait} ms: kept ${s.kept.size}, bad kept ${badKept}/${bad.length} (${Math.floor((100 * badKept) / bad.length)}%), incomplete ${incomplete}, late spans dropped ${s.late}, peak buffered ${s.peak}`);
}
const [a, b, c] = [results[100], results[1000], results[10000]];
const ok = c.badKept === bad.length && c.incomplete === 0 && a.badKept < b.badKept && b.badKept <= c.badKept && a.peak < b.peak && b.peak < c.peak && root.sampled;
console.log(`a longer wait keeps more bad traces and more of each trace, and buffers more: ${ok}`);
if (!ok) process.exit(1);
