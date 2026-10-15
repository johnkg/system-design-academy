// Memory per GPU, step time and checkpoint cost for distributed training, using integer arithmetic only.
// Assumptions: mixed-precision Adam = 16 bytes per parameter (2 weights + 2 gradients + 12 optimizer), 50% kernel
// efficiency of a 400 TFLOP/s GPU, 8 GPUs per node, 300 GB/s inside a node, 4096-token microbatches.
const div = (a, b) => Math.floor((a + Math.floor(b / 2)) / b); // integer division, rounded
const f1 = (x10) => `${Math.floor(x10 / 10)}.${x10 % 10}`; // tenths -> text
const MODELS = { 7: [32, 4096], 70: [80, 8192] }; // billions of parameters -> [layers, hidden size]

function plan(P, N, memGB, stage, tp, pp, m, interGBps) {
  const mp = tp * pp, dp = Math.floor(N / mp), [L, h] = MODELS[P];
  const w = div(20 * P, mp * (stage >= 3 ? dp : 1)); // GB x 10
  const g = div(20 * P, mp * (stage >= 2 ? dp : 1));
  const o = div(120 * P, mp * (stage >= 1 ? dp : 1));
  const a = div(5 * P, tp), total = w + g + o + a + 40; // activations + 4 GB fixed overhead
  const comp = div(6 * P * m * 4096, mp * 200); // ms of compute per step
  const bubble = div(comp * (pp - 1), m); // idle ms: (pp-1)/m of the compute time
  const tpMs = tp > 1 ? div(L * m * 4 * 2 * (tp - 1) * 4096 * h * 2, tp * pp * (tp <= 8 ? 300 : interGBps) * 1000000) : 0;
  const grad = div(2 * P * 1000000000, mp); // gradient bytes held by one model replica shard
  const dpBytes = div((stage >= 3 ? 3 : 2) * (dp - 1) * grad, dp); // ring: 2(d-1)/d x G, ZeRO-3 adds an all-gather
  const dpMs = dp > 1 ? div(dpBytes, (N <= 8 ? 300 : interGBps) * 1000000) : 0;
  const dpExposed = Math.max(0, dpMs - div(2 * comp, 3)); // hidden behind the backward pass (2/3 of compute)
  const step = comp + bubble + tpMs + dpExposed;
  return { total, fits: total <= memGB * 10, step, comm: div((tpMs + dpExposed) * 1000, step),
    bub: div(bubble * 1000, step), mfu: div(div(6 * P * m * 4096, mp * 400) * 1000, step), parts: [w, g, o, a] };
}

console.log("memory per GPU, 70B model on 64 GPUs of 80 GB, 8 microbatches");
const configs = [["plain data parallel", 0, 1, 1, 8], ["ZeRO-3 / FSDP", 3, 1, 1, 8], ["ZeRO-3, 1 microbatch", 3, 1, 1, 1],
  ["TP 8 + ZeRO-1", 1, 8, 1, 8], ["TP 16 + ZeRO-1", 1, 16, 1, 8], ["PP 8 + ZeRO-1", 1, 1, 8, 8], ["TP 4 x PP 4 + ZeRO-1", 1, 4, 4, 16]];
let lastTotal = null;
for (const [name, stage, tp, pp, m] of configs) {
  const r = plan(70, 64, 80, stage, tp, pp, m, 25);
  console.log(`${name.padEnd(22)} ${f1(r.total).padStart(6)} GB ${r.fits ? "fits" : "OOM "} step ${String(r.step).padStart(6)} ms comm ${f1(r.comm)}% bubble ${f1(r.bub)}% MFU ${f1(r.mfu)}%`);
  if (lastTotal !== null && name === "ZeRO-3 / FSDP" && !(r.total < lastTotal)) throw new Error("ZeRO-3 must use less memory");
  lastTotal = r.total;
}
const s = [0, 1, 2, 3].map((st) => plan(70, 64, 80, st, 1, 1, 8, 25).total);
for (let i = 1; i < 4; i++) if (!(s[i] < s[i - 1])) throw new Error("each ZeRO stage must reduce memory");

console.log("ring all-reduce of 1 GB of gradients (per GPU sends 2(d-1)/d of it, in 2(d-1) steps)");
for (const d of [2, 8, 64, 512]) {
  const sent = div(2 * (d - 1) * 1000, d); // MB sent per GPU
  console.log(`d=${String(d).padStart(3)} steps ${String(2 * (d - 1)).padStart(4)} sent ${sent} MB`);
  if (sent >= 2000 || sent < 1000) throw new Error("ring volume must stay below 2 x G");
}

console.log("pipeline bubble, 8 stages: idle share = (p-1)/(m+p-1)");
let prev = 1001;
for (const m of [1, 4, 8, 32, 64]) {
  const pm = div(7 * 1000, m + 7);
  console.log(`m=${String(m).padStart(2)} idle ${f1(pm)}%`);
  if (!(pm < prev)) throw new Error("more microbatches must shrink the bubble");
  prev = pm;
}

console.log("checkpoint interval, 70B model, 4096 GPUs, 50000 h per-GPU MTBF, 10 min restart, 50 GB/s checkpoint write");
const C = div(14 * 70, 50), mtbf = div(50000 * 3600, 4096), restart = 600; // seconds
for (const min of [5, 15, 60, 240]) {
  const t = min * 60;
  const pm = div(C * 1000, t) + div((div(t, 2) + restart) * 1000, mtbf);
  console.log(`every ${String(min).padStart(3)} min: overhead ${f1(pm)}%`);
}
console.log(`write ${C} s, cluster MTBF ${mtbf} s, best interval about ${Math.floor(Math.sqrt(2 * C * mtbf))} s`);
