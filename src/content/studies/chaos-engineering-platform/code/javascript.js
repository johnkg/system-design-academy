// A chaos experiment runner, in JavaScript:
// inject a fault into a small slice of a simulated fleet, watch the steady-state metric every tick,
// refuse experiments above the blast-radius limit, and abort and roll back when a guardrail is breached.

const N = 10, REQUESTS = 100, CAPACITY = 15, TICKS = 20, START = 5; // 10 instances, 100 requests per tick
const STEADY = 50, GUARD = 100, DETECT = 2;                           // error rates in requests per thousand
const PER_MILLE = 1000;

// 32-bit LCG (Numerical Recipes constants)
let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

function run(exp) {
  if (exp.targets > exp.limit) return { status: 'rejected', maxPm: 0, abortedAt: -1, restored: true };
  let dead = Array(N).fill(false), ejectAt = Array(N).fill(0), errPct = Array(N).fill(0), cap = Array(N).fill(CAPACITY);
  let cursor = 0, maxPm = 0, abortedAt = -1, violated = false;
  for (let t = 0; t < TICKS; t++) {
    if (t === START) {
      for (let i = 0; i < exp.targets; i++) {
        if (exp.kind === 'kill') { dead[i] = true; ejectAt[i] = t + DETECT; }
        else if (exp.kind === 'errors') errPct[i] = exp.value;
        else cap[i] = exp.value; // slow: the instance can serve only a few requests per tick
      }
    }
    const rotation = [...Array(N).keys()].filter((i) => !(dead[i] && t >= ejectAt[i])); // the load balancer drops dead instances after a delay
    const load = Array(N).fill(0);
    const attempt = (i) => {
      if (dead[i] || load[i] >= cap[i]) return false;
      load[i]++;
      return !(errPct[i] > 0 && random(100) < errPct[i]);
    };
    let errors = 0;
    for (let r = 0; r < REQUESTS; r++) {
      let ok = attempt(rotation[cursor++ % rotation.length]);
      if (!ok) ok = attempt(rotation[cursor++ % rotation.length]); // the client retries once
      if (!ok) errors++;
    }
    const pm = Math.floor(errors * PER_MILLE / REQUESTS);
    if (t >= START) {
      maxPm = Math.max(maxPm, pm);
      if (pm > STEADY) violated = true;
      if (pm > GUARD) { // guardrail breached: stop injecting and restore everything
        dead.fill(false); errPct.fill(0); cap.fill(CAPACITY); abortedAt = t;
        return { status: 'aborted', maxPm, abortedAt, restored: dead.every((d) => !d) && errPct.every((e) => e === 0) && cap.every((c) => c === CAPACITY) };
      }
    }
  }
  return { status: violated ? 'hypothesis disproved' : 'hypothesis held', maxPm, abortedAt, restored: true };
}

const experiments = [
  { name: 'errors on 2 instances', kind: 'errors', targets: 2, value: 30, limit: 3 },
  { name: 'slow 3 instances', kind: 'slow', targets: 3, value: 5, limit: 3 },
  { name: 'kill 5 instances', kind: 'kill', targets: 5, value: 0, limit: 5 },
  { name: 'kill 8 instances', kind: 'kill', targets: 8, value: 0, limit: 3 },
];
const results = experiments.map((e) => ({ e, r: run(e) }));
for (const { e, r } of results) {
  console.log(`${e.name}: ${r.status}, worst ${r.maxPm} per thousand${r.abortedAt >= 0 ? `, aborted at tick ${r.abortedAt}` : ''}`);
}
const by = Object.fromEntries(results.map(({ e, r }) => [e.kind + e.targets, r]));
const ok = by.errors2.status === 'hypothesis held' && by.kill8.status === 'rejected' && by.kill5.status === 'aborted' && results.every(({ r }) => r.restored);
console.log(`blast radius enforced, guardrail aborted the kill, fleet restored: ${ok}`);
if (!ok) process.exit(1);
