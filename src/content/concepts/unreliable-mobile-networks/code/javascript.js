// Loading one screen that needs 12 small requests over a flaky mobile link, with three client strategies, and then a fleet
// of phones reconnecting at once after an outage. Milliseconds and integers only; the seeds are fixed.
const REQS = 12;            // requests the screen needs
const ESSENTIAL = 4;        // the first 4 make the screen usable; the other 8 only fill it in
const MAX_ATTEMPTS = 4;     // attempts per request (or per batch) before giving up
const TRANSFER_MS = 20;     // time to move one request's data once the round trip is done
const RENDER_GAP_MS = 1500; // the sequential client renders each part before it asks for the next
const TAIL_MS = 1000;       // the radio stays awake this long after a transfer; a request after that wakes it again
const FIXED_TIMEOUT_MS = 1000;
const BASE_BACKOFF_MS = 500, MAX_BACKOFF_MS = 8000;
const RETRY_BUDGET = 12;    // retries the parallel client may spend in total across all its requests

function makeRng(seed) { let s = seed; return () => { s = (s * 48271) % 2147483647; return s; }; }

// The link: for every request and attempt, a loss roll (0 to 99) and a jitter roll (0 to 99). Same for every strategy.
function linkRolls() {
  const next = makeRng(150);
  const rows = [];
  for (let i = 0; i < REQS; i++) {
    const row = [];
    for (let j = 0; j < MAX_ATTEMPTS; j++) row.push({ roll: next() % 100, jit: next() % 100 });
    rows.push(row);
  }
  return rows;
}

// Exponential backoff with "equal jitter": half the delay is fixed, the other half is random.
const backoff = (attempt, jit) => { const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt); return Math.floor(cap / 2) + Math.floor((Math.floor(cap / 2) * jit) / 100); };

// Radio wake-ups: a transfer that starts more than TAIL_MS after the radio last went quiet wakes it again.
function wakeUps(intervals) {
  let last = -Infinity, wakes = 0;
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (start - last > TAIL_MS) wakes++;
    last = Math.max(last, end);
  }
  return wakes;
}

function loadScreen(strategy, lossPct, rtt) {
  const rolls = linkRolls();
  const intervals = [];
  let attempts = 0, failed = 0, usable = 0, essentialFailed = false;
  if (strategy === 'sequential') {
    let t = 0;
    for (let i = 0; i < REQS; i++) {
      let ok = false;
      for (let j = 0; j < MAX_ATTEMPTS && !ok; j++) {
        attempts++;
        const dur = rtt + TRANSFER_MS;
        if (rolls[i][j].roll >= lossPct && dur <= FIXED_TIMEOUT_MS) { intervals.push([t, t + dur]); t += dur; ok = true; }
        else { intervals.push([t, t + FIXED_TIMEOUT_MS]); t += FIXED_TIMEOUT_MS; } // wait out the fixed timeout, retry at once
      }
      if (!ok) { failed++; if (i < ESSENTIAL) essentialFailed = true; }
      if (i === ESSENTIAL - 1) usable = t;
      t += RENDER_GAP_MS;
    }
  } else if (strategy === 'parallel') {
    let budget = RETRY_BUDGET;
    for (let i = 0; i < REQS; i++) {
      let t = 0, ok = false;
      const timeout = 4 * rtt; // follows the network instead of a fixed number
      for (let j = 0; j < MAX_ATTEMPTS && !ok; j++) {
        attempts++;
        const dur = rtt + TRANSFER_MS;
        if (rolls[i][j].roll >= lossPct && dur <= timeout) { intervals.push([t, t + dur]); t += dur; ok = true; break; }
        intervals.push([t, t + timeout]); t += timeout;
        if (j === MAX_ATTEMPTS - 1 || budget === 0) break; // out of attempts, or the shared retry budget is spent
        budget--;
        t += backoff(j, rolls[i][j].jit);
      }
      if (!ok) { failed++; if (i < ESSENTIAL) essentialFailed = true; }
      else if (i < ESSENTIAL) usable = Math.max(usable, t);
    }
  } else {
    let t = 0, ok = false;
    const timeout = 4 * rtt + 300;
    for (let j = 0; j < MAX_ATTEMPTS && !ok; j++) {
      attempts++;
      const dur = rtt + TRANSFER_MS * REQS;
      // The reply is 12 times bigger, so it is twice as likely to be hit by the loss.
      if (rolls[0][j].roll >= Math.min(100, 2 * lossPct) && dur <= timeout) { intervals.push([t, t + dur]); t += dur; ok = true; break; }
      intervals.push([t, t + timeout]); t += timeout;
      if (j === MAX_ATTEMPTS - 1) break;
      t += backoff(j, rolls[0][j].jit);
    }
    if (ok) usable = t; else { failed = REQS; essentialFailed = true; }
  }
  return { usable: essentialFailed ? -1 : usable, attempts, failed, wakes: wakeUps(intervals) };
}

// A fleet reconnects at the same moment. The server can serve 2,000 requests a second; the rest get an error and retry.
const SERVER_CAPACITY = 2000;
const FLEET_MAX_ATTEMPTS = 8;
function fleet(phones, jitter) {
  const next = makeRng(11);
  const nextAt = new Array(phones).fill(0), attempt = new Array(phones).fill(0), pending = new Set();
  for (let p = 0; p < phones; p++) { if (jitter) nextAt[p] = next() % 10000; pending.add(p); } // jitter: each phone waits 0 to 10 s first
  let peak = 0, rejected = 0, gaveUp = 0, finished = 0;
  for (let sec = 0; sec < 300 && pending.size > 0; sec++) {
    const arrivals = [...pending].filter((p) => Math.floor(nextAt[p] / 1000) === sec).sort((a, b) => nextAt[a] - nextAt[b] || a - b);
    if (arrivals.length === 0) continue;
    peak = Math.max(peak, arrivals.length);
    arrivals.forEach((p, k) => {
      if (k < SERVER_CAPACITY) { pending.delete(p); finished = sec; return; }
      rejected++;
      attempt[p]++;
      if (attempt[p] >= FLEET_MAX_ATTEMPTS) { gaveUp++; pending.delete(p); return; }
      const delay = Math.min(60000, 1000 * 2 ** (attempt[p] - 1));
      nextAt[p] += jitter ? next() % delay : delay; // full jitter spreads the retries; without it they come back in step
    });
  }
  return { peak, rejected, gaveUp, finished };
}

const NAMES = { sequential: 'sequential, fixed 1,000 ms timeout, immediate retry', parallel: 'parallel, backoff with jitter, retry budget', batch: 'one batched request' };
for (const [loss, rtt] of [[10, 300], [30, 300], [10, 1200]]) {
  console.log(`-- packet loss ${loss}%, round trip ${rtt} ms`);
  for (const s of ['sequential', 'parallel', 'batch']) {
    const r = loadScreen(s, loss, rtt);
    console.log(`  ${NAMES[s]}: usable after ${r.usable < 0 ? 'never' : `${r.usable} ms`}; ${r.attempts} requests sent; ${r.failed} failed; ${r.wakes} radio wake-ups`);
  }
}
console.log('-- 10000 phones reconnect at once, server serves 2000 requests a second');
for (const jitter of [false, true]) {
  const f = fleet(10000, jitter);
  console.log(`  ${jitter ? 'with' : 'without'} jitter: peak ${f.peak} requests/s, ${f.rejected} rejected, all served by second ${f.finished}, ${f.gaveUp} gave up`);
}
