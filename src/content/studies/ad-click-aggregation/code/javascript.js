// Ad click counting by event time, in JavaScript:
// tumbling windows are closed by a watermark (the newest event time seen, minus the allowed lateness),
// events for a closed window are dropped as late, and a set of click ids removes duplicates.

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// 400 true clicks over 300 seconds. Most arrive within 2 s, some are held up for up to 45 s (a phone that was offline).
// About 1 click in 8 is sent twice (a retry), and the copy arrives a few seconds, sometimes up to a minute, later.
function makeStream() {
  const events = [];
  for (let id = 0; id < 400; id++) {
    const t = random(300), u = random(100);
    const delay = u < 85 ? random(3) : u < 97 ? 2 + random(9) : 10 + random(36);
    events.push({ id, t, arrival: t + delay, copy: 0 });
    if (random(8) === 0) events.push({ id, t, arrival: t + delay + (random(5) < 4 ? 1 + random(7) : 15 + random(41)), copy: 1 });
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
  return { total, late, duplicates, lost: 400 - counted.size, avgDelay: Math.floor(delaySum / closedCount) };
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
  if (!r.dedup && r.total - 400 + r.lost !== r.duplicates) ok = false; // counted = clicks seen + double counts
}
const full = aggregate(events, 30, 60, true);                   // more lateness than any delay, with dedup: exact
if (full.total !== 400 || full.lost !== 0 || full.late !== 0) ok = false;
const a = aggregate(events, 30, 0, true), b = aggregate(events, 30, 5, true), c = aggregate(events, 30, 30, true);
if (!(a.late >= b.late && b.late >= c.late && c.late >= full.late)) ok = false; // more lateness never drops more
console.log(`invariants hold: ${ok}`);
if (!ok) process.exit(1);
