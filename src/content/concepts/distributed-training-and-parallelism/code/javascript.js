// Memory per GPU, step time and checkpoint cost for distributed training, using integer arithmetic only.
// Assumptions: mixed-precision Adam = 16 bytes per parameter (2 weights + 2 gradients + 12 optimizer), 50% kernel
// efficiency of a 400 TFLOP/s GPU, 8 GPUs per node, 300 GB/s inside a node, 4096-token microbatches.
const div = (a, b) => Math.floor((a + Math.floor(b / 2)) / b); // integer division, rounded
const f1 = (x10) => `${Math.floor(x10 / 10)}.${x10 % 10}`; // tenths -> text
const MODELS = { 7: [32, 4096], 70: [80, 8192] }; // billions of parameters -> [layers, hidden size]
const TENTHS = 10, PERCENT_X10 = 100 * TENTHS; // memory and percentages are carried in tenths
const BF16_BYTES = 2;
const WEIGHT_BYTES = BF16_BYTES, GRAD_BYTES = BF16_BYTES, OPTIMIZER_BYTES = 12; // per parameter (Adam state in fp32)
const ACTIVATION_X10 = 5; // activations: 0.5 GB per billion parameters, split by tensor parallelism
const OVERHEAD_GB = 4; // fixed per-GPU overhead
const FLOPS_PER_PARAM_TOKEN = 6; // forward + backward
const TOKENS_PER_MICROBATCH = 4096;
const PEAK_TFLOPS = 400, EFFECTIVE_TFLOPS = PEAK_TFLOPS / 2; // 50% kernel efficiency
const GPUS_PER_NODE = 8, NVLINK_GBPS = 300; // bandwidth inside a node
const TP_ALLREDUCES_PER_LAYER = 4; // 2 in the forward pass, 2 in the backward pass
const BYTES_PER_GB = 1000000000, BYTES_PER_MS_PER_GBPS = 1000000;
const MODEL_B = 70, GPUS = 64, GPU_MEMORY_GB = 80, INTER_NODE_GBPS = 25, MICROBATCHES = 8;
const GRADIENT_MB = 1000; // 1 GB of gradients in the ring demo
const PIPELINE_STAGES = 8;
const CHECKPOINT_BYTES_PER_PARAM = WEIGHT_BYTES + OPTIMIZER_BYTES, CHECKPOINT_WRITE_GBPS = 50;
const CLUSTER_GPUS = 4096, GPU_MTBF_HOURS = 50000;
const SECONDS_PER_MINUTE = 60, SECONDS_PER_HOUR = 3600, RESTART_S = 10 * SECONDS_PER_MINUTE;

function plan(P, N, memGB, stage, tp, pp, m, interGBps) {
  const mp = tp * pp, dp = Math.floor(N / mp), [L, h] = MODELS[P];
  const w = div(WEIGHT_BYTES * TENTHS * P, mp * (stage >= 3 ? dp : 1)); // GB x 10
  const g = div(GRAD_BYTES * TENTHS * P, mp * (stage >= 2 ? dp : 1));
  const o = div(OPTIMIZER_BYTES * TENTHS * P, mp * (stage >= 1 ? dp : 1));
  const a = div(ACTIVATION_X10 * P, tp), total = w + g + o + a + OVERHEAD_GB * TENTHS; // activations + fixed overhead
  const comp = div(FLOPS_PER_PARAM_TOKEN * P * m * TOKENS_PER_MICROBATCH, mp * EFFECTIVE_TFLOPS); // ms of compute per step
  const bubble = div(comp * (pp - 1), m); // idle ms: (pp-1)/m of the compute time
  const tpMs = tp > 1 ? div(L * m * TP_ALLREDUCES_PER_LAYER * 2 * (tp - 1) * TOKENS_PER_MICROBATCH * h * BF16_BYTES, tp * pp * (tp <= GPUS_PER_NODE ? NVLINK_GBPS : interGBps) * BYTES_PER_MS_PER_GBPS) : 0;
  const grad = div(GRAD_BYTES * P * BYTES_PER_GB, mp); // gradient bytes held by one model replica shard
  const dpBytes = div((stage >= 3 ? 3 : 2) * (dp - 1) * grad, dp); // ring: 2(d-1)/d x G, ZeRO-3 adds an all-gather
  const dpMs = dp > 1 ? div(dpBytes, (N <= GPUS_PER_NODE ? NVLINK_GBPS : interGBps) * BYTES_PER_MS_PER_GBPS) : 0;
  const dpExposed = Math.max(0, dpMs - div(2 * comp, 3)); // hidden behind the backward pass (2/3 of compute)
  const step = comp + bubble + tpMs + dpExposed;
  return { total, fits: total <= memGB * TENTHS, step, comm: div((tpMs + dpExposed) * PERCENT_X10, step),
    bub: div(bubble * PERCENT_X10, step), mfu: div(div(FLOPS_PER_PARAM_TOKEN * P * m * TOKENS_PER_MICROBATCH, mp * PEAK_TFLOPS) * PERCENT_X10, step), parts: [w, g, o, a] };
}

console.log("memory per GPU, 70B model on 64 GPUs of 80 GB, 8 microbatches");
const configs = [["plain data parallel", 0, 1, 1, 8], ["ZeRO-3 / FSDP", 3, 1, 1, 8], ["ZeRO-3, 1 microbatch", 3, 1, 1, 1],
  ["TP 8 + ZeRO-1", 1, 8, 1, 8], ["TP 16 + ZeRO-1", 1, 16, 1, 8], ["PP 8 + ZeRO-1", 1, 1, 8, 8], ["TP 4 x PP 4 + ZeRO-1", 1, 4, 4, 16]];
let lastTotal = null;
for (const [name, stage, tp, pp, m] of configs) {
  const r = plan(MODEL_B, GPUS, GPU_MEMORY_GB, stage, tp, pp, m, INTER_NODE_GBPS);
  console.log(`${name.padEnd(22)} ${f1(r.total).padStart(6)} GB ${r.fits ? "fits" : "OOM "} step ${String(r.step).padStart(6)} ms comm ${f1(r.comm)}% bubble ${f1(r.bub)}% MFU ${f1(r.mfu)}%`);
  if (lastTotal !== null && name === "ZeRO-3 / FSDP" && !(r.total < lastTotal)) throw new Error("ZeRO-3 must use less memory");
  lastTotal = r.total;
}
const s = [0, 1, 2, 3].map((st) => plan(MODEL_B, GPUS, GPU_MEMORY_GB, st, 1, 1, MICROBATCHES, INTER_NODE_GBPS).total);
for (let i = 1; i < s.length; i++) if (!(s[i] < s[i - 1])) throw new Error("each ZeRO stage must reduce memory");

console.log("ring all-reduce of 1 GB of gradients (per GPU sends 2(d-1)/d of it, in 2(d-1) steps)");
for (const d of [2, 8, 64, 512]) {
  const sent = div(2 * (d - 1) * GRADIENT_MB, d); // MB sent per GPU
  console.log(`d=${String(d).padStart(3)} steps ${String(2 * (d - 1)).padStart(4)} sent ${sent} MB`);
  if (sent >= 2 * GRADIENT_MB || sent < GRADIENT_MB) throw new Error("ring volume must stay below 2 x G");
}

console.log("pipeline bubble, 8 stages: idle share = (p-1)/(m+p-1)");
let prev = PERCENT_X10 + 1;
for (const m of [1, 4, 8, 32, 64]) {
  const pm = div((PIPELINE_STAGES - 1) * PERCENT_X10, m + PIPELINE_STAGES - 1);
  console.log(`m=${String(m).padStart(2)} idle ${f1(pm)}%`);
  if (!(pm < prev)) throw new Error("more microbatches must shrink the bubble");
  prev = pm;
}

console.log("checkpoint interval, 70B model, 4096 GPUs, 50000 h per-GPU MTBF, 10 min restart, 50 GB/s checkpoint write");
const C = div(CHECKPOINT_BYTES_PER_PARAM * MODEL_B, CHECKPOINT_WRITE_GBPS), mtbf = div(GPU_MTBF_HOURS * SECONDS_PER_HOUR, CLUSTER_GPUS), restart = RESTART_S; // seconds
for (const min of [5, 15, 60, 240]) {
  const t = min * SECONDS_PER_MINUTE;
  const pm = div(C * PERCENT_X10, t) + div((div(t, 2) + restart) * PERCENT_X10, mtbf);
  console.log(`every ${String(min).padStart(3)} min: overhead ${f1(pm)}%`);
}
console.log(`write ${C} s, cluster MTBF ${mtbf} s, best interval about ${Math.floor(Math.sqrt(2 * C * mtbf))} s`);
