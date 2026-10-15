# KV cache memory and a decode-step latency model for one 8B-class model on one 80 GB GPU.
# All math is integer so the output is identical in every language. Constants are stated assumptions, not vendor numbers.
LAYERS, HEAD_DIM = 32, 128
WEIGHTS = 16_000_000_000          # 8e9 parameters x 2 bytes (fp16)
GPU_BYTES = 80_000_000_000
USABLE = GPU_BYTES * 9 // 10      # keep 10% for activations, CUDA context, fragmentation
BW_BYTES_PER_US = 2_000_000       # 2 TB/s memory bandwidth
FLOPS_PER_US = 200_000_000        # 200 TFLOP/s achievable
FLOPS_PER_TOKEN = 16_000_000_000  # 2 x parameters per generated token
MAX_BATCH = 256


def kv_bytes_per_token(kv_heads, bits):
    # 2 (K and V) x layers x kv_heads x head_dim x bytes per value
    return 2 * LAYERS * kv_heads * HEAD_DIM * bits // 8


def max_sequences(kv_per_token, ctx):
    return min(MAX_BATCH, (USABLE - WEIGHTS) // (kv_per_token * ctx))


def decode_step_us(batch, kv_per_token, ctx):
    # One decode step reads every weight once plus every sequence's whole KV cache.
    memory_us = (WEIGHTS + batch * kv_per_token * ctx) // BW_BYTES_PER_US
    compute_us = batch * FLOPS_PER_TOKEN // FLOPS_PER_US
    return max(memory_us, compute_us), ("memory" if memory_us >= compute_us else "compute")


def prefill_ms(ctx):
    return ctx * FLOPS_PER_TOKEN // FLOPS_PER_US // 1000


configs = [
    ("MHA-32 fp16", 32, 16, 8192),
    ("GQA-8  fp16", 8, 16, 8192),
    ("GQA-8  fp8 ", 8, 8, 8192),
    ("GQA-8  int4", 8, 4, 8192),
    ("MQA-1  fp16", 1, 16, 8192),
    ("GQA-8  fp16", 8, 16, 32768),
    ("GQA-8  fp16", 8, 16, 131072),
]
results = []
for name, heads, bits, ctx in configs:
    kvt = kv_bytes_per_token(heads, bits)
    n = max_sequences(kvt, ctx)
    s1, _ = decode_step_us(1, kvt, ctx)
    line = f"{name} ctx={ctx:6d} kv/token={kvt:6d}B kv/seq={kvt * ctx // 1_000_000:5d}MB max_seqs={n:3d} ttft={prefill_ms(ctx):5d}ms step1={s1:5d}us tps1={1_000_000 // s1:4d}"
    if n >= 1:
        sn, bound = decode_step_us(n, kvt, ctx)
        line += f" stepN={sn:6d}us tpsN={n * 1_000_000 // sn:5d} {bound}-bound"
        results.append((heads, bits, ctx, kvt, n, s1, sn))
    print(line)

# Invariants: GQA-8 is 4x smaller than MHA-32; fp8 halves it again; a longer context never fits more sequences.
assert kv_bytes_per_token(32, 16) == 4 * kv_bytes_per_token(8, 16) == 524288
assert kv_bytes_per_token(8, 8) * 2 == kv_bytes_per_token(8, 16)
assert max_sequences(131072, 8192) > max_sequences(131072, 32768) > max_sequences(131072, 131072)
assert all(s1 >= WEIGHTS // BW_BYTES_PER_US for *_, s1, _ in results)   # a step can never beat reading the weights
mha_n, gqa_n = results[0][4], results[1][4]
assert gqa_n > 3 * mha_n and results[1][6] > 0
print(f"GQA-8 serves {gqa_n} sequences where MHA-32 serves {mha_n}")
