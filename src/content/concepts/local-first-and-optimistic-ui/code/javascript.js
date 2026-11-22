// Three ways a to-do app can handle 20 user actions: wait for the server, update optimistically, or work local-first.
// Fixed seed and integer maths only, so the output never changes.
const ACTIONS = 20;
const UI_MS = 16;               // time to redraw the screen from local state
const OFFLINE_NOTICE_MS = 3000; // a request that cannot reach the server is given up on after this long
const SEED = 2024;

// Park-Miller generator: the same integers in every language.
function makeRng(seed) {
  let s = seed;
  return () => { s = (s * 48271) % 2147483647; return s; };
}

// Each action gets a latency jitter (0 to 30 percent) and a roll (0 to 99): the server fails it when roll < failure rate.
function plan() {
  const next = makeRng(SEED);
  const actions = [];
  for (let i = 0; i < ACTIONS; i++) actions.push({ jitter: next() % 31, roll: next() % 100 });
  return actions;
}

// offlineAfter: the connection drops after this many actions, and the app is closed while still offline.
function run(mode, latencyMs, failPct, offlineAfter) {
  let shownTotal = 0, rolledBack = 0, lost = 0, failed = 0, saved = 0, queued = 0;
  plan().forEach((a, i) => {
    const online = i < offlineAfter;
    const lat = Math.floor((latencyMs * (100 + a.jitter)) / 100);
    const fails = online && a.roll < failPct;
    if (fails) failed++;
    if (mode === 'wait') {
      shownTotal += online ? lat : OFFLINE_NOTICE_MS; // the screen changes only when the server answers
      if (online && !fails) saved++;
      if (!online) lost++;                            // typed, never sent, gone when the app closes
    } else if (mode === 'optimistic') {
      shownTotal += UI_MS;                            // the screen changes at once
      if (fails) rolledBack++;                        // ...and is wrong until the failure arrives
      if (online && !fails) saved++;
      if (!online) lost++;                            // the user saw it applied, the pending request dies with the app
    } else {
      shownTotal += UI_MS;                            // written to the local database, screen redrawn
      if (online) saved++;                            // failed requests stay in the queue and are retried
      else queued++;                                  // still in the persisted queue when the app closes
    }
  });
  const avg = Math.floor(shownTotal / ACTIONS);
  console.log(`${mode.padEnd(10)} screen changes after ${avg} ms on average; rolled back ${rolledBack}; failed requests ${failed}; on the server ${saved}; lost on close ${lost}; kept in queue ${queued}`);
}

for (const [latency, fail] of [[400, 15], [1200, 30]]) {
  console.log(`-- latency ${latency} ms, server failures ${fail}%, connection drops after action 14`);
  for (const mode of ['wait', 'optimistic', 'local']) run(mode, latency, fail, 14);
}
