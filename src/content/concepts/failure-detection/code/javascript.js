// Failure detection from heartbeat arrivals only: a fixed timeout vs a phi accrual detector.
// Integer milliseconds everywhere; the only floats are phi values, formatted explicitly.
const CRASH_BEAT = 140;       // the sender dies after beat 139 (t = 139 s)
const END_MS = 160000;        // the monitor stops watching here
const TICK_MS = 100;          // the monitor checks every 100 ms
const BEAT_MS = 1000;         // one heartbeat per second
const PER_MILLE = 1000;       // random draws are 0..999 per mille
const BASE_DELAY_MS = 20, SPIKE_MIN_MS = 400, SPIKE_EXTRA_MS = 2000;
const PAUSE_FIRST_BEAT = 60, PAUSE_END_BEAT = 65;      // GC pause: these beats are never sent
const LOSSY_FIRST_BEAT = 100, LOSSY_END_BEAT = 104, LOSS_PER_MILLE = 700;
const TRACE_SEED = 1, JITTER_MS = 50, SPIKE_PER_MILLE = 50;

function lcg(seed) {          // 32-bit linear congruential generator, same in every language
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 16; };
}

// One heartbeat per second. Delay = 20 ms + jitter, with a 5% chance of a 0.4-2.4 s spike.
// Beats 60-64 are never sent (a GC pause that silences the sender for about 6 s); beats 100-103 are lost with 70% probability.
function makeTrace(seed, jitter, spikePerMille) {
  const next = lcg(seed * 7919 + 13);
  const arrivals = [];
  for (let k = 0; k < CRASH_BEAT; k++) {
    const sum = (next() % PER_MILLE) + (next() % PER_MILLE) + (next() % PER_MILLE) + (next() % PER_MILLE);
    const spike = next() % PER_MILLE, extra = next() % SPIKE_EXTRA_MS, loss = next() % PER_MILLE;
    if (k >= PAUSE_FIRST_BEAT && k < PAUSE_END_BEAT) continue;
    if (k >= LOSSY_FIRST_BEAT && k < LOSSY_END_BEAT && loss < LOSS_PER_MILLE) continue;
    let delay = BASE_DELAY_MS + Math.floor((jitter * sum) / PER_MILLE);
    if (spike < spikePerMille) delay += SPIKE_MIN_MS + extra;
    arrivals.push(BEAT_MS * k + delay);
  }
  return arrivals.sort((a, b) => a - b);
}

class FixedTimeout {
  constructor(timeoutMs) { this.timeoutMs = timeoutMs; }
  arrive() {}
  suspect(silenceMs) { return silenceMs > this.timeoutMs; }
}

const PRIOR_LOW_MS = 750, PRIOR_HIGH_MS = 1250; // seed guess: 1 s +- 250 ms
const LOGISTIC_A = 1.5976, LOGISTIC_B = 0.070566; // logistic fit to the normal tail
const MIN_P = 1e-16, MAX_PHI = 16; // cap phi where the probability underflows

class PhiAccrual {            // Akka-style: logistic approximation of the normal tail
  constructor(threshold, windowSize = 100, minStdMs = 100) {
    this.threshold = threshold; this.windowSize = windowSize; this.minStdMs = minStdMs;
    this.window = [PRIOR_LOW_MS, PRIOR_HIGH_MS]; this.sum = PRIOR_LOW_MS + PRIOR_HIGH_MS;
    this.sumSq = PRIOR_LOW_MS * PRIOR_LOW_MS + PRIOR_HIGH_MS * PRIOR_HIGH_MS;
  }
  arrive(intervalMs) {
    this.window.push(intervalMs); this.sum += intervalMs; this.sumSq += intervalMs * intervalMs;
    if (this.window.length > this.windowSize) { const old = this.window.shift(); this.sum -= old; this.sumSq -= old * old; }
  }
  phi(silenceMs) {
    const n = this.window.length, mean = this.sum / n;
    const std = Math.max(Math.sqrt(Math.max(0, this.sumSq / n - mean * mean)), this.minStdMs);
    const y = (silenceMs - mean) / std;
    const e = Math.exp(-y * (LOGISTIC_A + LOGISTIC_B * y * y));
    const p = silenceMs > mean ? e / (1 + e) : 1 - 1 / (1 + e);  // P(heartbeat arrives later than now)
    return p < MIN_P ? MAX_PHI : -Math.log10(p);
  }
  suspect(silenceMs) { return this.phi(silenceMs) >= this.threshold; }
}

// A suspicion that a later heartbeat clears is a false alarm; the one still standing at the end is the detection.
function evaluate(arrivals, detector) {
  let i = 0, last = -1, suspected = false, since = 0;
  const falseAlarms = [];
  for (let t = 0; t <= END_MS; t += TICK_MS) {
    while (i < arrivals.length && arrivals[i] <= t) {
      if (last >= 0) detector.arrive(arrivals[i] - last);
      last = arrivals[i++];
      if (suspected) { falseAlarms.push(since); suspected = false; }
    }
    if (last >= 0 && !suspected && detector.suspect(t - last)) { suspected = true; since = t; }
  }
  return { falseAlarms, detectMs: suspected ? since - last : -1, detector };
}

const fmt2 = (x) => { const n = Math.floor(x * 100 + 0.5); return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`; };
const trace = makeTrace(TRACE_SEED, JITTER_MS, SPIKE_PER_MILLE);
console.log(`trace: ${trace.length} heartbeats, last at ${trace[trace.length - 1]} ms`);
const results = {};
for (const [name, det] of [["fixed 2000 ms", new FixedTimeout(2000)], ["fixed 5000 ms", new FixedTimeout(5000)], ["fixed 10000 ms", new FixedTimeout(10000)],
                           ["phi >= 4", new PhiAccrual(4)], ["phi >= 8", new PhiAccrual(8)], ["phi >= 12", new PhiAccrual(12)]]) {
  const r = evaluate(trace, det); results[name] = r;
  console.log(`${name.padEnd(14)} false alarms ${r.falseAlarms.length} [${r.falseAlarms.join(" ")}]  crash detected after ${r.detectMs} ms`);
}
const phi8 = results["phi >= 8"].detector;
console.log("phi at the end, after 1000/2000/3000/5000 ms of silence: " + [1000, 2000, 3000, 5000].map((s) => fmt2(phi8.phi(s))).join(" / "));

const f2 = results["fixed 2000 ms"], f10 = results["fixed 10000 ms"], p8 = results["phi >= 8"];
console.assert(p8.detectMs > 0 && f2.detectMs > 0 && f10.detectMs > 0, "every detector must catch the crash");
console.assert(p8.falseAlarms.length <= f2.falseAlarms.length, "phi must not be worse than a 2 s timeout on the jittery trace");
console.assert(f10.falseAlarms.length === 0 && f10.detectMs > p8.detectMs, "the long timeout buys accuracy with detection time");
if (!(p8.detectMs > 0 && p8.falseAlarms.length <= f2.falseAlarms.length && f10.falseAlarms.length === 0 && f10.detectMs > p8.detectMs)) process.exit(1);
