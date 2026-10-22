// Ad click counting by event time, in JavaScript:
// tumbling windows are closed by a watermark (the newest event time seen, minus the allowed lateness),
// events for a closed window are dropped as late, and a set of click ids removes duplicates.

const SEED = 7, CLICKS = 400, SPAN_S = 300;
const ON_TIME_PCT = 85, HELD_PCT = 12; // the remaining 3% come from phones that were offline
const ON_TIME_SPREAD = 3, HELD_MIN = 2, HELD_SPREAD = 9, OFFLINE_MIN = 10, OFFLINE_SPREAD = 36; // delays 0..2, 2..10, 10..45 s
const RETRY_ONE_IN = 8;
const SOON_IN_5 = 4, SOON_MIN = 1, SOON_SPREAD = 7, LATE_COPY_MIN = 15, LATE_COPY_SPREAD = 41; // copy delay: 4 in 5 after 1..7 s, else 15..55 s
const WINDOW_S = 30, EXACT_LATENESS = 60; // EXACT_LATENESS exceeds every delay in the stream

let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// 400 true clicks over 300 seconds. Most arrive within 2 s, some are held up for up to 45 s (a phone that was offline).
// About 1 click in 8 is sent twice (a retry), and the copy arrives a few seconds, sometimes up to a minute, later.
function makeStream() {
  const events = [];
  for (let id = 0; id < CLICKS; id++) {
    const t = random(SPAN_S), u = random(100);
    const delay = u < ON_TIME_PCT ? random(ON_TIME_SPREAD) : u < ON_TIME_PCT + HELD_PCT ? HELD_MIN + random(HELD_SPREAD) : OFFLINE_MIN + random(OFFLINE_SPREAD);
    events.push({ id, t, arrival: t + delay, copy: 0 });
    if (random(RETRY_ONE_IN) === 0) events.push({ id, t, arrival: t + delay + (random(5) < SOON_IN_5 ? SOON_MIN + random(SOON_SPREAD) : LATE_COPY_MIN + random(LATE_COPY_SPREAD)), copy: 1 });
  }
  return events.sort((a, b) => a.arrival - b.arrival || a.id - b.id || a.copy - b.copy);
}

function aggregate(events, windowSize, lateness, dedup) {
  const seen = new Set(), counts = new Map(), counted = new Set();
  let maxTime = -1, closedUpTo = -1, late = 0, duplicates = 0, delaySum = 0, closedCount = 0;
  for (const e of events) {
    const w = Math.floor(e.t / windowSize);
    if (w <= closedUpTo) { late++; continue; }                  // its window is already final
    if (dedup && seen.has(e.id)) continue;                      // the same click again
    seen.add(e.id);
    if (counted.has(e.id)) duplicates++;                        // a click counted twice
    counted.add(e.id);
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (e.t > maxTime) {                                        // the watermark can only move forward
      maxTime = e.t;
      while ((closedUpTo + 2) * windowSize <= maxTime - lateness) { // the next window ends before the watermark
        closedUpTo++; delaySum += e.arrival - (closedUpTo + 1) * windowSize; closedCount++;
      }
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { total, late, duplicates, lost: CLICKS - counted.size, avgDelay: Math.floor(delaySum / closedCount) };
}

const events = makeStream();
const copies = events.filter((e) => e.copy === 1).length;
console.log(`stream: ${events.length} events = 400 clicks + ${copies} retried copies`);
const rows = [];
for (const [windowSize, lateness, dedup] of [[30, 0, false], [30, 5, false], [30, 5, true], [30, 30, true], [30, 60, true], [10, 5, true], [60, 5, true]]) {
  const r = aggregate(events, windowSize, lateness, dedup);
  rows.push({ windowSize, lateness, dedup, ...r });
  console.log(`window ${windowSize}s lateness ${lateness}s dedup ${dedup ? 'on ' : 'off'}: counted ${r.total}, lost ${r.lost}, double counted ${r.duplicates}, late events dropped ${r.late}, window final after ${r.avgDelay}s`);
}

let ok = true;
for (const r of rows) {
  if (r.dedup && r.duplicates !== 0) ok = false;                // dedup never counts a click twice
  if (!r.dedup && r.total - CLICKS + r.lost !== r.duplicates) ok = false; // counted = clicks seen + double counts
}
const full = aggregate(events, WINDOW_S, EXACT_LATENESS, true);                   // more lateness than any delay, with dedup: exact
if (full.total !== CLICKS || full.lost !== 0 || full.late !== 0) ok = false;
const a = aggregate(events, WINDOW_S, 0, true), b = aggregate(events, WINDOW_S, 5, true), c = aggregate(events, WINDOW_S, 30, true);
if (!(a.late >= b.late && b.late >= c.late && c.late >= full.late)) ok = false; // more lateness never drops more
console.log(`invariants hold: ${ok}`);
if (!ok) process.exit(1);
