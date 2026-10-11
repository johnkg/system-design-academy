// Tumbling event-time windows with a bounded-out-of-orderness watermark.
// Events arrive in processing order; each carries the event time (seconds) when the click happened.

const WINDOW = 10;
const EVENTS = [1, 3, 12, 8, 5, 14, 22, 11, 25, 9, 31, 18, 35, 27, 41, 33]; // event times, in arrival order

function run(delay, verbose) {
  // Returns { fired, late }. fired maps window start -> count emitted when the watermark passed its end.
  const openWindows = new Map(); // window start -> count, still waiting for the watermark
  const fired = new Map();
  const late = [];
  let maxTime = null;
  let watermark = null; // null means "nothing seen yet"

  const fireReady = (label) => {
    for (const start of [...openWindows.keys()].sort((a, b) => a - b)) {
      if (start + WINDOW <= watermark) {
        fired.set(start, openWindows.get(start));
        openWindows.delete(start);
        if (verbose) console.log(`  ${label} wm=${watermark} fire [${start},${start + WINDOW}) count=${fired.get(start)}`);
      }
    }
  };

  for (const t of EVENTS) {
    const start = Math.floor(t / WINDOW) * WINDOW;
    if (watermark !== null && start + WINDOW <= watermark) {
      late.push(t); // its window already fired: the result cannot be updated
      if (verbose) console.log(`  t=${t} wm=${watermark} LATE, dropped`);
      continue;
    }
    openWindows.set(start, (openWindows.get(start) ?? 0) + 1);
    maxTime = maxTime === null ? t : Math.max(maxTime, t);
    watermark = maxTime - delay; // the watermark never moves backwards because maxTime does not
    fireReady(`t=${t}`);
  }
  // End of input: the watermark jumps to infinity and flushes everything left.
  watermark = 1000000000;
  fireReady("end");
  return { fired, late };
}

const truth = new Map();
for (const t of EVENTS) {
  const s = Math.floor(t / WINDOW) * WINDOW;
  truth.set(s, (truth.get(s) ?? 0) + 1);
}

for (const delay of [0, 5, 20]) {
  console.log(`watermark delay ${delay}s`);
  const { fired, late } = run(delay, delay === 5);
  let error = 0;
  for (const [s, n] of truth) error += Math.abs(n - (fired.get(s) ?? 0));
  let counted = 0;
  for (const n of fired.values()) counted += n;
  console.log(`  windows=${fired.size} counted=${counted} late=${late.length} error=${error}`);
  if (counted + late.length !== EVENTS.length) throw new Error("every event is counted or late");
  if (error !== late.length) throw new Error("the only error is the dropped late events");
  if (delay === 20 && late.length !== 0) throw new Error("a delay above the worst disorder (16s) drops nothing");
}
