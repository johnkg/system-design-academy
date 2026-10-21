// Trace context and a tail sampler in JavaScript:
// spans carry a W3C traceparent, arrive out of order, and a sampler buffers each trace for a wait before deciding to keep or drop it.

const formatTraceparent = (traceId, spanId, sampled) => `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
function parseTraceparent(header) {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header);
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null; // all-zero ids are invalid
  return { traceId: m[1], spanId: m[2], sampled: (parseInt(m[3], 16) & 1) === 1 };
}

const SEED = 77;
const TRACES = 400;
const TRACE_GAP_MS = 10; // a trace starts about every 10 ms
const ID_WORDS = 4; // 32-bit words in a 128-bit trace id
const MIN_SPANS = 3; // spans per trace: 3..7
const SPAN_SPREAD = 5;
const FAILED_PCT = 4; // traces that fail
const BAD_PCT = 10; // traces that fail or are slow
const FAILED_MIN_MS = 30; // root span duration of a failed trace: 30..229 ms
const FAILED_SPREAD_MS = 200;
const SLOW_MIN_MS = 800; // of a slow trace: 800..1999 ms
const SLOW_SPREAD_MS = 1200;
const FAST_MIN_MS = 20; // of an ordinary trace: 20..99 ms
const FAST_SPREAD_MS = 80;
const ASYNC_PCT = 10; // child spans that run async, ending 1..4 s after the root
const ASYNC_MIN_MS = 1000;
const ASYNC_SPREAD_MS = 3000;
const EXPORT_MIN_MS = 5; // export delay before a span reaches the collector: 5..124 ms
const EXPORT_SPREAD_MS = 120;
const SLOW_THRESHOLD_MS = 500; // a root span this long marks a slow trace
const BASELINE_PCT = 2; // ordinary traces kept anyway

let seed = SEED;
const nextU32 = () => (seed = (seed * 1664525 + 1013904223) % 4294967296);
const next = (n) => Math.floor(nextU32() / 65536) % n;
const hex = (n, width) => n.toString(16).padStart(width, '0');

// 400 traces. About 4% fail and 6% are slow; 10% have an async span that ends long after the root span.
function makeTraces() {
  const traces = [], events = [];
  for (let i = 0; i < TRACES; i++) {
    const start = i * TRACE_GAP_MS + next(TRACE_GAP_MS);
    const traceId = Array.from({ length: ID_WORDS }, () => hex(nextU32(), 8)).join('');
    const kind = next(100), n = MIN_SPANS + next(SPAN_SPREAD);
    const rootDur = kind < FAILED_PCT ? FAILED_MIN_MS + next(FAILED_SPREAD_MS) : kind < BAD_PCT ? SLOW_MIN_MS + next(SLOW_SPREAD_MS) : FAST_MIN_MS + next(FAST_SPREAD_MS);
    const errAt = kind < FAILED_PCT ? 1 + next(n - 1) : -1;
    traces.push({ traceId, n, bad: kind < BAD_PCT });
    for (let k = 0; k < n; k++) {
      let off = 0, dur = rootDur;
      if (k > 0) { off = next(Math.floor(rootDur / 2) + 1); dur = 1 + next(Math.max(1, rootDur - off)); }
      if (k > 0 && next(100) < ASYNC_PCT) off += ASYNC_MIN_MS + next(ASYNC_SPREAD_MS); // async span, ends after the root
      const arrival = start + off + dur + EXPORT_MIN_MS + next(EXPORT_SPREAD_MS);
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
    const slow = t.spans.some((s) => s.root && s.dur >= SLOW_THRESHOLD_MS), error = t.spans.some((s) => s.err);
    const baseline = parseInt(t.id.slice(0, 8), 16) % 100 < BASELINE_PCT; // keep 2% of ordinary traces
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
const WAITS = [100, 1000, 10000]; // ms a trace stays open before the keep decision
for (const wait of WAITS) {
  const s = new TailSampler(wait);
  events.forEach((e) => s.add(e));
  s.finish();
  const badKept = bad.filter((t) => s.kept.has(t.traceId)).length;
  const incomplete = traces.filter((t) => s.kept.has(t.traceId) && s.kept.get(t.traceId) < t.n).length;
  results[wait] = { badKept, incomplete, peak: s.peak };
  console.log(`wait ${wait} ms: kept ${s.kept.size}, bad kept ${badKept}/${bad.length} (${Math.floor((100 * badKept) / bad.length)}%), incomplete ${incomplete}, late spans dropped ${s.late}, peak buffered ${s.peak}`);
}
const [a, b, c] = WAITS.map((w) => results[w]);
const ok = c.badKept === bad.length && c.incomplete === 0 && a.badKept < b.badKept && b.badKept <= c.badKept && a.peak < b.peak && b.peak < c.peak && root.sampled;
console.log(`a longer wait keeps more bad traces and more of each trace, and buffers more: ${ok}`);
if (!ok) process.exit(1);
