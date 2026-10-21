// Batch vs stream on the same late-arriving events: count orders per 10-minute window of EVENT time.
// The stream answers fast from a watermark and drops what comes too late; the batch recomputes the log on a schedule.

const WIN = 600, NWIN = 8, REPORT = 6, SPAN = 4800; // window (s), windows, windows reported, event-time span (s)
const LATE_MIN = 20; // a late event arrives at least this many seconds after it happened
const ON_TIME_JITTER = 4; // an on-time event arrives 0..3 s after it happened
const SECONDS_PER_MINUTE = 60;
const EVENT_COUNT = 800, LATE_PCT = 10, LATE_MAX = 300, SEED = 7;
const SHORT_WAIT = 30; // seconds the first stream waits past a window's end

function generate(n, latePct, lateMax, seed) {
  let s = seed >>> 0;
  // 32-bit LCG (Numerical Recipes constants)
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; };
  const events = [];
  for (let i = 0; i < n; i++) {
    const t = next() % SPAN; // when it happened (event time, seconds)
    const r = next() % 100;
    const delay = r < latePct ? LATE_MIN + (next() % (lateMax - LATE_MIN + 1)) : next() % ON_TIME_JITTER;
    events.push({ i, t, a: t + delay }); // a = when it reaches us (processing time)
  }
  return events;
}

function trueCounts(events) {
  const c = new Array(REPORT).fill(0);
  for (const e of events) { const w = Math.floor(e.t / WIN); if (w < REPORT) c[w]++; }
  return c;
}

// Stream: one pass in arrival order. A window is emitted once watermark = newest event time - wait passes its end.
function runStream(events, wait) {
  const order = [...events].sort((x, y) => x.a - y.a || x.t - y.t || x.i - y.i);
  const count = new Array(NWIN).fill(0), emitted = new Array(NWIN).fill(false);
  const at = new Array(NWIN).fill(0), seen = new Array(NWIN).fill(0);
  let dropped = 0, maxT = -1, last = 0;
  for (const e of order) {
    const w = Math.floor(e.t / WIN);
    last = e.a;
    if (emitted[w]) { if (w < REPORT) dropped++; } else count[w]++; // too late: the window is already out
    if (e.t > maxT) maxT = e.t;
    for (let x = 0; x < NWIN; x++) {
      if (!emitted[x] && (x + 1) * WIN <= maxT - wait) { emitted[x] = true; at[x] = e.a; seen[x] = count[x]; }
    }
  }
  for (let x = 0; x < NWIN; x++) if (!emitted[x]) { emitted[x] = true; at[x] = last; seen[x] = count[x]; }
  const truth = trueCounts(events);
  const rows = truth.map((t, w) => ({ w, truth: t, first: seen[w], firstAt: at[w], exactAt: seen[w] === t ? at[w] : -1 }));
  return { rows, read: events.length, dropped };
}

// Batch: every `minutes` re-read the whole log. A window is exact at the first run that has seen all of its events.
function runBatch(events, minutes) {
  const step = minutes * SECONDS_PER_MINUTE, truth = trueCounts(events);
  const countAt = (w, run) => events.filter((e) => e.a <= run && Math.floor(e.t / WIN) === w).length;
  const rows = []; let lastRun = 0;
  for (let w = 0; w < REPORT; w++) {
    let run = Math.ceil(((w + 1) * WIN) / step) * step;
    const firstAt = run, first = countAt(w, run);
    while (countAt(w, run) !== truth[w]) run += step;
    rows.push({ w, truth: truth[w], first, firstAt, exactAt: run });
    lastRun = Math.max(lastRun, run);
  }
  let read = 0;
  for (let run = step; run <= lastRun; run += step) read += events.filter((e) => e.a <= run).length;
  return { rows, read, dropped: 0 };
}

const mean = (xs) => Math.floor(xs.reduce((a, b) => a + b, 0) / xs.length + 0.5);
function report(label, res) {
  const missing = res.rows.reduce((a, r) => a + r.truth - r.first, 0);
  const total = res.rows.reduce((a, r) => a + r.truth, 0);
  const delay = mean(res.rows.map((r) => r.firstAt - (r.w + 1) * WIN));
  console.log(`${label}: first answer +${delay}s, missing ${missing}/${total}, events read ${res.read}`);
  return missing;
}

const events = generate(EVENT_COUNT, LATE_PCT, LATE_MAX, SEED);
const stream30 = runStream(events, SHORT_WAIT);
console.log("window  true  first  answered_at");
for (const r of stream30.rows) console.log(`${r.w}       ${r.truth}   ${r.first}    +${r.firstAt - (r.w + 1) * WIN}s`);

const missStream30 = report("stream wait 30s ", stream30);
const missStream300 = report("stream wait 300s", runStream(events, LATE_MAX));
const batch15 = runBatch(events, 15);
const batch60 = runBatch(events, 60);
report("batch every 15m", batch15);
report("batch every 60m", batch60);

// Invariants: dropped events are exactly the missing ones, a long wait loses nothing, and every batch ends exact.
if (missStream30 !== stream30.dropped) throw new Error("dropped count mismatch");
if (missStream300 !== 0) throw new Error("a wait as long as the lateness must lose nothing");
for (const b of [batch15, batch60]) if (b.rows.some((r) => r.exactAt < 0)) throw new Error("batch must end exact");
console.log("invariants ok");
