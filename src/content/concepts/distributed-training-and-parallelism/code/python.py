# Memory per GPU, step time and checkpoint cost for distributed training, using integer arithmetic only.
# Assumptions: mixed-precision Adam = 16 bytes per parameter (2 weights + 2 gradients + 12 optimizer), 50% kernel
# efficiency of a 400 TFLOP/s GPU, 8 GPUs per node, 300 GB/s inside a node, 4096-token microbatches.
import math


def div(a, b):  # integer division, rounded
    return (a + b // 2) // b


def f1(x10):  # tenths -> text
    return f"{x10 // 10}.{x10 % 10}"


MODELS = {7: (32, 4096), 70: (80, 8192)}  # billions of parameters -> (layers, hidden size)
TENTHS = 10  # memory and percentages are carried in tenths
PERCENT_X10 = 100 * TENTHS
BF16_BYTES = 2
WEIGHT_BYTES, GRAD_BYTES, OPTIMIZER_BYTES = BF16_BYTES, BF16_BYTES, 12  # per parameter (Adam state in fp32)
ACTIVATION_X10 = 5  # activations: 0.5 GB per billion parameters, split by tensor parallelism
OVERHEAD_GB = 4  # fixed per-GPU overhead
FLOPS_PER_PARAM_TOKEN = 6  # forward + backward
TOKENS_PER_MICROBATCH = 4096
PEAK_TFLOPS = 400
EFFECTIVE_TFLOPS = PEAK_TFLOPS // 2  # 50% kernel efficiency
GPUS_PER_NODE, NVLINK_GBPS = 8, 300  # bandwidth inside a node
TP_ALLREDUCES_PER_LAYER = 4  # 2 in the forward pass, 2 in the backward pass
BYTES_PER_GB, BYTES_PER_MS_PER_GBPS = 1000000000, 1000000
MODEL_B, GPUS, GPU_MEMORY_GB, INTER_NODE_GBPS, MICROBATCHES = 70, 64, 80, 25, 8
GRADIENT_MB = 1000  # 1 GB of gradients in the ring demo
PIPELINE_STAGES = 8
CHECKPOINT_BYTES_PER_PARAM, CHECKPOINT_WRITE_GBPS = WEIGHT_BYTES + OPTIMIZER_BYTES, 50
CLUSTER_GPUS, GPU_MTBF_HOURS = 4096, 50000
SECONDS_PER_MINUTE, SECONDS_PER_HOUR = 60, 3600
RESTART_S = 10 * SECONDS_PER_MINUTE


def plan(P, N, mem_gb, stage, tp, pp, m, inter_gbps):
    mp = tp * pp
    dp = N // mp
    L, h = MODELS[P]
    w = div(WEIGHT_BYTES * TENTHS * P, mp * (dp if stage >= 3 else 1))  # GB x 10
    g = div(GRAD_BYTES * TENTHS * P, mp * (dp if stage >= 2 else 1))
    o = div(OPTIMIZER_BYTES * TENTHS * P, mp * (dp if stage >= 1 else 1))
    a = div(ACTIVATION_X10 * P, tp)
    total = w + g + o + a + OVERHEAD_GB * TENTHS  # activations + fixed overhead
    comp = div(FLOPS_PER_PARAM_TOKEN * P * m * TOKENS_PER_MICROBATCH, mp * EFFECTIVE_TFLOPS)  # ms of compute per step
    bubble = div(comp * (pp - 1), m)  # idle ms: (pp-1)/m of the compute time
    tp_ms = div(L * m * TP_ALLREDUCES_PER_LAYER * 2 * (tp - 1) * TOKENS_PER_MICROBATCH * h * BF16_BYTES,
                tp * pp * (NVLINK_GBPS if tp <= GPUS_PER_NODE else inter_gbps) * BYTES_PER_MS_PER_GBPS) if tp > 1 else 0
    grad = div(GRAD_BYTES * P * BYTES_PER_GB, mp)  # gradient bytes held by one model replica shard
    dp_bytes = div((3 if stage >= 3 else 2) * (dp - 1) * grad, dp)  # ring: 2(d-1)/d x G, ZeRO-3 adds an all-gather
    dp_ms = div(dp_bytes, (NVLINK_GBPS if N <= GPUS_PER_NODE else inter_gbps) * BYTES_PER_MS_PER_GBPS) if dp > 1 else 0
    dp_exposed = max(0, dp_ms - div(2 * comp, 3))  # hidden behind the backward pass (2/3 of compute)
    step = comp + bubble + tp_ms + dp_exposed
    return {"total": total, "fits": total <= mem_gb * TENTHS, "step": step, "comm": div((tp_ms + dp_exposed) * PERCENT_X10, step),
            "bub": div(bubble * PERCENT_X10, step),
            "mfu": div(div(FLOPS_PER_PARAM_TOKEN * P * m * TOKENS_PER_MICROBATCH, mp * PEAK_TFLOPS) * PERCENT_X10, step)}


print("memory per GPU, 70B model on 64 GPUs of 80 GB, 8 microbatches")
configs = [("plain data parallel", 0, 1, 1, 8), ("ZeRO-3 / FSDP", 3, 1, 1, 8), ("ZeRO-3, 1 microbatch", 3, 1, 1, 1),
           ("TP 8 + ZeRO-1", 1, 8, 1, 8), ("TP 16 + ZeRO-1", 1, 16, 1, 8), ("PP 8 + ZeRO-1", 1, 1, 8, 8), ("TP 4 x PP 4 + ZeRO-1", 1, 4, 4, 16)]
last_total = None
for name, stage, tp, pp, m in configs:
    r = plan(MODEL_B, GPUS, GPU_MEMORY_GB, stage, tp, pp, m, INTER_NODE_GBPS)
    print(f"{name.ljust(22)} {f1(r['total']).rjust(6)} GB {'fits' if r['fits'] else 'OOM '} step {str(r['step']).rjust(6)} ms comm {f1(r['comm'])}% bubble {f1(r['bub'])}% MFU {f1(r['mfu'])}%")
    if last_total is not None and name == "ZeRO-3 / FSDP" and not r["total"] < last_total:
        raise SystemExit("ZeRO-3 must use less memory")
    last_total = r["total"]
s = [plan(MODEL_B, GPUS, GPU_MEMORY_GB, st, 1, 1, MICROBATCHES, INTER_NODE_GBPS)["total"] for st in range(4)]
for i in range(1, len(s)):
    if not s[i] < s[i - 1]:
        raise SystemExit("each ZeRO stage must reduce memory")

print("ring all-reduce of 1 GB of gradients (per GPU sends 2(d-1)/d of it, in 2(d-1) steps)")
for d in [2, 8, 64, 512]:
    sent = div(2 * (d - 1) * GRADIENT_MB, d)  # MB sent per GPU
    print(f"d={str(d).rjust(3)} steps {str(2 * (d - 1)).rjust(4)} sent {sent} MB")
    if sent >= 2 * GRADIENT_MB or sent < GRADIENT_MB:
        raise SystemExit("ring volume must stay below 2 x G")

print("pipeline bubble, 8 stages: idle share = (p-1)/(m+p-1)")
prev = PERCENT_X10 + 1
for m in [1, 4, 8, 32, 64]:
    pm = div((PIPELINE_STAGES - 1) * PERCENT_X10, m + PIPELINE_STAGES - 1)
    print(f"m={str(m).rjust(2)} idle {f1(pm)}%")
    if not pm < prev:
        raise SystemExit("more microbatches must shrink the bubble")
    prev = pm

print("checkpoint interval, 70B model, 4096 GPUs, 50000 h per-GPU MTBF, 10 min restart, 50 GB/s checkpoint write")
C = div(CHECKPOINT_BYTES_PER_PARAM * MODEL_B, CHECKPOINT_WRITE_GBPS)
mtbf = div(GPU_MTBF_HOURS * SECONDS_PER_HOUR, CLUSTER_GPUS)
restart = RESTART_S  # seconds
for minutes in [5, 15, 60, 240]:
    t = minutes * SECONDS_PER_MINUTE
    pm = div(C * PERCENT_X10, t) + div((div(t, 2) + restart) * PERCENT_X10, mtbf)
    print(f"every {str(minutes).rjust(3)} min: overhead {f1(pm)}%")
print(f"write {C} s, cluster MTBF {mtbf} s, best interval about {math.floor(math.sqrt(2 * C * mtbf))} s")
