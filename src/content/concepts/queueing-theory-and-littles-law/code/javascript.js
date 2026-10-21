// A deterministic single-server queue (M/M/1, FIFO) simulated event by event, then checked against Little's law L = lambda * W.
// A seeded LCG supplies the random numbers, so every run (and every language) prints the same text.

class Lcg {
  constructor(seed) { this.s = seed >>> 0; }
  next() { // uniform in (0, 1]
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return (this.s + 1) / 4294967296;
  }
  exp(mean) { return -mean * Math.log(this.next()); } // inverse transform sampling
}

const SERVICE_MS = 50;
const N = 20000;
const ARRIVAL_SEED = 12345;
const SERVICE_SEED = 67890;
const MS_PER_SECOND = 1000;
const TOLERANCE = 1e-6; // relative floating-point slack for Little's law

function simulate(rho) {
  const arrivals = new Lcg(ARRIVAL_SEED), services = new Lcg(SERVICE_SEED);
  const meanGap = SERVICE_MS / rho; // utilisation = service time / gap between arrivals
  const arrive = [], depart = [];
  let t = 0, free = 0, wait = 0, busy = 0;
  for (let i = 0; i < N; i++) {
    t += arrivals.exp(meanGap);
    const service = services.exp(SERVICE_MS);
    const start = Math.max(t, free); // the server takes the job when it arrives or when it frees up
    wait += start - t;
    busy += service;
    free = start + service;
    arrive.push(t);
    depart.push(free);
  }
  // Integrate the number in system over time by walking arrivals (+1) and departures (-1) in order.
  let area = 0, inSystem = 0, last = 0, a = 0, d = 0;
  while (d < N) {
    const isArrival = a < N && arrive[a] <= depart[d];
    const now = isArrival ? arrive[a] : depart[d];
    area += inSystem * (now - last);
    last = now;
    if (isArrival) { inSystem++; a++; } else { inSystem--; d++; }
  }
  let sojourn = 0;
  for (let i = 0; i < N; i++) sojourn += depart[i] - arrive[i];
  return { util: busy / last, wait: wait / N, L: area / last, lambda: (N / last) * MS_PER_SECOND, W: sojourn / N };
}

const f2 = (x) => x.toFixed(2);
let previous = -1;
console.log("rho  util  wait_ms  theory_ms  L  lambda_per_s  W_ms  L-lambda*W");
for (const rho of [0.5, 0.7, 0.8, 0.9, 0.95]) {
  const r = simulate(rho);
  const theory = (rho / (1 - rho)) * SERVICE_MS; // M/M/1 mean wait
  const gap = Math.abs(r.L - (r.lambda / MS_PER_SECOND) * r.W);
  console.log(`${f2(rho)} ${f2(r.util)} ${f2(r.wait)} ${f2(theory)} ${f2(r.L)} ${f2(r.lambda)} ${f2(r.W)} ${gap.toFixed(6)}`);
  if (gap > TOLERANCE * Math.max(1, r.L)) { console.error("Little's law violated"); process.exit(1); }
  if (r.wait <= previous) { console.error("wait must grow with load"); process.exit(1); }
  previous = r.wait;
}
// Sizing: concurrency = rate x latency, then add headroom so the pool is not a hockey stick.
const rate = 1000, latencyMs = 50, headroom = 0.7;
const inFlight = (rate * latencyMs) / MS_PER_SECOND;
console.log(`in flight: ${f2(inFlight)}, pool at ${f2(headroom)} target: ${Math.ceil(inFlight / headroom)}`);
