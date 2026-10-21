// KV cache memory and a decode-step latency model for one 8B-class model on one 80 GB GPU.
// All math is integer so the output is identical in every language. Constants are stated assumptions, not vendor numbers.
const LAYERS = 32, HEAD_DIM = 128;
const WEIGHTS = 16_000_000_000;          // 8e9 parameters x 2 bytes (fp16)
const GPU_BYTES = 80_000_000_000;
const USABLE = Math.floor(GPU_BYTES * 9 / 10); // keep 10% for activations, CUDA context, fragmentation
const BW_BYTES_PER_US = 2_000_000;       // 2 TB/s memory bandwidth
const FLOPS_PER_US = 200_000_000;        // 200 TFLOP/s achievable
const FLOPS_PER_TOKEN = 16_000_000_000;  // 2 x parameters per generated token
const MAX_BATCH = 256;
const BITS_PER_BYTE = 8, US_PER_MS = 1000;
const div = (a, b) => Math.floor(a / b);
const pad = (v, n) => String(v).padStart(n);

function kvBytesPerToken(kvHeads, bits) {
  // 2 (K and V) x layers x kv_heads x head_dim x bytes per value
  return div(2 * LAYERS * kvHeads * HEAD_DIM * bits, BITS_PER_BYTE);
}
function maxSequences(kvPerToken, ctx) {
  return Math.min(MAX_BATCH, div(USABLE - WEIGHTS, kvPerToken * ctx));
}
function decodeStepUs(batch, kvPerToken, ctx) {
  // One decode step reads every weight once plus every sequence's whole KV cache.
  const memoryUs = div(WEIGHTS + batch * kvPerToken * ctx, BW_BYTES_PER_US);
  const computeUs = div(batch * FLOPS_PER_TOKEN, FLOPS_PER_US);
  return [Math.max(memoryUs, computeUs), memoryUs >= computeUs ? "memory" : "compute"];
}
const prefillMs = (ctx) => div(div(ctx * FLOPS_PER_TOKEN, FLOPS_PER_US), US_PER_MS);

const configs = [
  ["MHA-32 fp16", 32, 16, 8192],
  ["GQA-8  fp16", 8, 16, 8192],
  ["GQA-8  fp8 ", 8, 8, 8192],
  ["GQA-8  int4", 8, 4, 8192],
  ["MQA-1  fp16", 1, 16, 8192],
  ["GQA-8  fp16", 8, 16, 32768],
  ["GQA-8  fp16", 8, 16, 131072],
];
const results = [];
for (const [name, heads, bits, ctx] of configs) {
  const kvt = kvBytesPerToken(heads, bits);
  const n = maxSequences(kvt, ctx);
  const [s1] = decodeStepUs(1, kvt, ctx);
  let line = `${name} ctx=${pad(ctx, 6)} kv/token=${pad(kvt, 6)}B kv/seq=${pad(div(kvt * ctx, 1_000_000), 5)}MB max_seqs=${pad(n, 3)} ttft=${pad(prefillMs(ctx), 5)}ms step1=${pad(s1, 5)}us tps1=${pad(div(1_000_000, s1), 4)}`;
  if (n >= 1) {
    const [sn, bound] = decodeStepUs(n, kvt, ctx);
    line += ` stepN=${pad(sn, 6)}us tpsN=${pad(div(n * 1_000_000, sn), 5)} ${bound}-bound`;
    results.push({ heads, bits, ctx, kvt, n, s1, sn });
  }
  console.log(line);
}

// Invariants: GQA-8 is 4x smaller than MHA-32; fp8 halves it again; a longer context never fits more sequences.
const check = (ok, msg) => { if (!ok) { console.error("invariant violated: " + msg); process.exit(1); } };
check(kvBytesPerToken(32, 16) === 4 * kvBytesPerToken(8, 16) && kvBytesPerToken(32, 16) === 524288, "GQA is 4x smaller");
check(kvBytesPerToken(8, 8) * 2 === kvBytesPerToken(8, 16), "fp8 halves the cache");
check(maxSequences(131072, 8192) > maxSequences(131072, 32768) && maxSequences(131072, 32768) > maxSequences(131072, 131072), "longer context fits fewer");
check(results.every((r) => r.s1 >= div(WEIGHTS, BW_BYTES_PER_US)), "a step cannot beat reading the weights");
const mhaN = results[0].n, gqaN = results[1].n;
check(gqaN > 3 * mhaN && results[1].sn > 0, "GQA serves more sequences");
console.log(`GQA-8 serves ${gqaN} sequences where MHA-32 serves ${mhaN}`);
