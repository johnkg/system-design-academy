// A tiny serverless platform, in JavaScript:
// every instance runs one request at a time, the router reuses a warm idle instance or starts a cold one (if the cap allows),
// idle instances are reaped after a timeout, and provisioned instances stay for ever.

const END = 600 * 1000; // ten minutes of traffic, in milliseconds

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Requests per second for each pattern. Every request has a start time and a run time of 50 to 149 ms.
function traffic(pattern) {
  seed = 7;
  const requests = [];
  for (let s = 0; s < 600; s++) {
    let rate = 40;                                                   // steady
    if (pattern === 'bursty') rate = s % 90 < 8 ? 150 : 15;
    if (pattern === 'spiky') rate = [30, 270, 510].some((a) => s >= a && s < a + 6) ? 250 : 0;
    for (let i = 0; i < rate; i++) requests.push({ t: s * 1000 + random(1000), ms: 50 + random(100), n: requests.length });
  }
  return requests.sort((a, b) => a.t - b.t || a.n - b.n);
}

function run(requests, { idleSeconds, provisioned, initMs, cap }) {
  const idle = idleSeconds * 1000;
  let pool = Array.from({ length: provisioned }, () => ({ busyUntil: 0, kept: true }));
  let cold = 0, throttled = 0, billedMs = 0, idleMs = 0, peak = provisioned;
  const latencies = [];
  for (const r of requests) {
    // Reap on-demand instances that have been idle for longer than the timeout.
    pool = pool.filter((x) => { const dead = !x.kept && x.busyUntil <= r.t && x.busyUntil + idle < r.t; if (dead) idleMs += idle; return !dead; });
    // Prefer a free provisioned instance, then the most recently used free one (so the others can go idle and be reaped).
    let best = null;
    for (const x of pool) if (x.busyUntil <= r.t && (!best || (x.kept ? 1e12 : 0) + x.busyUntil > (best.kept ? 1e12 : 0) + best.busyUntil)) best = x;
    if (best) {
      if (!best.kept) idleMs += r.t - best.busyUntil;
      best.busyUntil = r.t + r.ms; latencies.push(r.ms); billedMs += r.ms;
    } else if (pool.length < cap) {                                  // scale from zero: a new instance pays the start before it runs
      cold++; pool.push({ busyUntil: r.t + initMs + r.ms, kept: false });
      latencies.push(initMs + r.ms); billedMs += initMs + r.ms; peak = Math.max(peak, pool.length);
    } else throttled++;                                              // at the cap: rejected
  }
  for (const x of pool) if (!x.kept) idleMs += Math.max(0, Math.min(idle, END - x.busyUntil));
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.floor((latencies.length * p + 99) / 100) - 1]; // nearest rank
  const costMicro = Math.floor(billedMs / 60) + Math.floor((provisioned * END) / 240) + Math.floor(latencies.length / 5); // millionths of a dollar
  return { cold, throttled, served: latencies.length, peak, p50: pct(50), p95: pct(95), p99: pct(99), billedMs, idleSeconds: Math.floor(idleMs / 1000), costMicro };
}

const show = (label, cfg, r) => console.log(`${label} (idle ${cfg.idleSeconds} s, provisioned ${cfg.provisioned}, init ${cfg.initMs} ms, cap ${cfg.cap}): cold ${r.cold}, throttled ${r.throttled}, p50/p95/p99 ${r.p50}/${r.p95}/${r.p99} ms, billed ${r.billedMs} ms, warm idle ${r.idleSeconds} s, cost ${r.costMicro} micro-dollars`);
const base = { idleSeconds: 60, provisioned: 0, initMs: 800, cap: 100 };

const requests = {};
for (const pattern of ['steady', 'bursty', 'spiky']) {
  requests[pattern] = traffic(pattern);
  const r = run(requests[pattern], base);
  show(`${pattern.padEnd(6)} ${requests[pattern].length} requests`, base, r);
  if (r.served + r.throttled !== requests[pattern].length || r.peak > base.cap) process.exit(1);
}

console.log('--- the same spiky traffic with one change at a time');
const spiky = requests.spiky;
const results = {};
for (const [name, change] of [['baseline', {}], ['longer idle timeout', { idleSeconds: 240 }], ['provisioned 30', { provisioned: 30 }], ['faster init', { initMs: 200 }], ['higher cap', { cap: 300 }]]) {
  const cfg = { ...base, ...change };
  results[name] = run(spiky, cfg);
  show(name.padEnd(19), cfg, results[name]);
}
const b = results.baseline;
const ok = b.throttled > 0 && b.cold > 0
  && results['longer idle timeout'].cold < b.cold                    // survives the 234 s of silence
  && results['higher cap'].throttled < b.throttled
  && results['faster init'].p99 < b.p99
  && results['provisioned 30'].costMicro > 3 * b.costMicro;          // paying all day for a 6-second spike
console.log(`each change helps what it should, and provisioned concurrency costs more: ${ok}`);
if (!ok) process.exit(1);
