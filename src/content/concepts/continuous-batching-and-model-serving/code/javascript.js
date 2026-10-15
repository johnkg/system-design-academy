// Static vs continuous batching over the same seeded request stream (one GPU replica, one decode step at a time).
// Step cost = 20 ms (weights read once) + 1 ms per sequence in the batch; prefill = 1 ms per 10 prompt tokens.
const BASE = 20, PER = 1, MAX_BATCH = 8;

function makeRequests(n, seed, meanGap) {
  let s = seed, t = 0;
  const nxt = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; };
  const reqs = [];
  for (let i = 0; i < n; i++) {
    t += Math.floor(((nxt() % 1000) * 2 * meanGap) / 1000); // arrival time in ms
    const out = nxt() % 100 < 80 ? 16 + (nxt() % 48) : 200 + (nxt() % 200);
    reqs.push({ at: t, out, prompt: 64 + (nxt() % 900) });
  }
  return reqs;
}

function simulate(reqs, mode) {
  let t = 0, nx = 0, steps = 0, tokens = 0, active = [];
  const finish = new Array(reqs.length).fill(-1), queue = [];
  for (;;) {
    while (nx < reqs.length && reqs[nx].at <= t) queue.push(nx++);
    if (active.length === 0 && queue.length === 0) {
      if (nx >= reqs.length) break;
      t = reqs[nx].at; // GPU idle until the next arrival
      continue;
    }
    let prefill = 0;
    // continuous: refill free slots every step; static: only when the whole batch is empty
    while ((mode === "continuous" || active.length === 0) && active.length < MAX_BATCH && queue.length) {
      const i = queue.shift();
      prefill += Math.floor((reqs[i].prompt + 9) / 10);
      active.push([i, reqs[i].out]);
    }
    t += BASE + PER * active.length + prefill; // finished static slots still cost compute (padding)
    steps++;
    for (const a of active) if (a[1] > 0) { a[1]--; tokens++; }
    if (mode === "continuous") {
      for (const a of active) if (a[1] === 0) finish[a[0]] = t; // leaves now, slot reused next step
      active = active.filter((a) => a[1] > 0);
    } else if (active.every((a) => a[1] === 0)) {
      for (const a of active) finish[a[0]] = t; // whole batch answers when the longest ends
      active = [];
    }
  }
  const lat = reqs.map((r, i) => finish[i] - r.at).sort((a, b) => a - b);
  const slots = steps * MAX_BATCH;
  return {
    tokens, tps: Math.floor((tokens * 1000) / t), p50: lat[Math.floor(((lat.length - 1) * 50) / 100)],
    p95: lat[Math.floor(((lat.length - 1) * 95) / 100)], idle: Math.floor((100 * (slots - tokens)) / slots), steps, end: t,
  };
}

const reqs = makeRequests(24, 7, 100);
const total = reqs.reduce((sum, r) => sum + r.out, 0);
const res = {};
for (const mode of ["static", "continuous"]) {
  const r = (res[mode] = simulate(reqs, mode));
  if (r.tokens !== total) throw new Error("every requested token must be generated exactly once");
  console.log(`${mode.padEnd(10)} tokens/s=${r.tps} p50=${r.p50}ms p95=${r.p95}ms idle_slots=${r.idle}% steps=${r.steps} finished_at=${r.end}ms`);
}
if (!(res.continuous.tps > res.static.tps && res.continuous.p95 < res.static.p95)) throw new Error("continuous should win");
console.log(`continuous batching: ${Math.floor((res.continuous.tps * 100) / res.static.tps)}% of static throughput, ` +
  `p95 ${Math.floor((res.continuous.p95 * 100) / res.static.p95)}% of static`);
