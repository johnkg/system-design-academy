# Memory per GPU, step time and checkpoint cost for distributed training, using integer arithmetic only.
# Assumptions: mixed-precision Adam = 16 bytes per parameter (2 weights + 2 gradients + 12 optimizer), 50% kernel
# efficiency of a 400 TFLOP/s GPU, 8 GPUs per node, 300 GB/s inside a node, 4096-token microbatches.
import math


def div(a, b):  # integer division, rounded
    return (a + b // 2) // b


def f1(x10):  # tenths -> text
    return f"{x10 // 10}.{x10 % 10}"


MODELS = {7: (32, 4096), 70: (80, 8192)}  # billions of parameters -> (layers, hidden size)


def plan(P, N, mem_gb, stage, tp, pp, m, inter_gbps):
    mp = tp * pp
    dp = N // mp
    L, h = MODELS[P]
    w = div(20 * P, mp * (dp if stage >= 3 else 1))  # GB x 10
    g = div(20 * P, mp * (dp if stage >= 2 else 1))
    o = div(120 * P, mp * (dp if stage >= 1 else 1))
    a = div(5 * P, tp)
    total = w + g + o + a + 40  # activations + 4 GB fixed overhead
    comp = div(6 * P * m * 4096, mp * 200)  # ms of compute per step
    bubble = div(comp * (pp - 1), m)  # idle ms: (pp-1)/m of the compute time
    tp_ms = div(L * m * 4 * 2 * (tp - 1) * 4096 * h * 2, tp * pp * (300 if tp <= 8 else inter_gbps) * 1000000) if tp > 1 else 0
    grad = div(2 * P * 1000000000, mp)  # gradient bytes held by one model replica shard
    dp_bytes = div((3 if stage >= 3 else 2) * (dp - 1) * grad, dp)  # ring: 2(d-1)/d x G, ZeRO-3 adds an all-gather
    dp_ms = div(dp_bytes, (300 if N <= 8 else inter_gbps) * 1000000) if dp > 1 else 0
    dp_exposed = max(0, dp_ms - div(2 * comp, 3))  # hidden behind the backward pass (2/3 of compute)
    step = comp + bubble + tp_ms + dp_exposed
    return {"total": total, "fits": total <= mem_gb * 10, "step": step, "comm": div((tp_ms + dp_exposed) * 1000, step),
            "bub": div(bubble * 1000, step), "mfu": div(div(6 * P * m * 4096, mp * 400) * 1000, step)}


print("memory per GPU, 70B model on 64 GPUs of 80 GB, 8 microbatches")
configs = [("plain data parallel", 0, 1, 1, 8), ("ZeRO-3 / FSDP", 3, 1, 1, 8), ("ZeRO-3, 1 microbatch", 3, 1, 1, 1),
           ("TP 8 + ZeRO-1", 1, 8, 1, 8), ("TP 16 + ZeRO-1", 1, 16, 1, 8), ("PP 8 + ZeRO-1", 1, 1, 8, 8), ("TP 4 x PP 4 + ZeRO-1", 1, 4, 4, 16)]
last_total = None
for name, stage, tp, pp, m in configs:
    r = plan(70, 64, 80, stage, tp, pp, m, 25)
    print(f"{name.ljust(22)} {f1(r['total']).rjust(6)} GB {'fits' if r['fits'] else 'OOM '} step {str(r['step']).rjust(6)} ms comm {f1(r['comm'])}% bubble {f1(r['bub'])}% MFU {f1(r['mfu'])}%")
    if last_total is not None and name == "ZeRO-3 / FSDP" and not r["total"] < last_total:
        raise SystemExit("ZeRO-3 must use less memory")
    last_total = r["total"]
s = [plan(70, 64, 80, st, 1, 1, 8, 25)["total"] for st in range(4)]
for i in range(1, 4):
    if not s[i] < s[i - 1]:
        raise SystemExit("each ZeRO stage must reduce memory")

print("ring all-reduce of 1 GB of gradients (per GPU sends 2(d-1)/d of it, in 2(d-1) steps)")
for d in [2, 8, 64, 512]:
    sent = div(2 * (d - 1) * 1000, d)  # MB sent per GPU
    print(f"d={str(d).rjust(3)} steps {str(2 * (d - 1)).rjust(4)} sent {sent} MB")
    if sent >= 2000 or sent < 1000:
        raise SystemExit("ring volume must stay below 2 x G")

print("pipeline bubble, 8 stages: idle share = (p-1)/(m+p-1)")
prev = 1001
for m in [1, 4, 8, 32, 64]:
    pm = div(7 * 1000, m + 7)
    print(f"m={str(m).rjust(2)} idle {f1(pm)}%")
    if not pm < prev:
        raise SystemExit("more microbatches must shrink the bubble")
    prev = pm

print("checkpoint interval, 70B model, 4096 GPUs, 50000 h per-GPU MTBF, 10 min restart, 50 GB/s checkpoint write")
C = div(14 * 70, 50)
mtbf = div(50000 * 3600, 4096)
restart = 600  # seconds
for minutes in [5, 15, 60, 240]:
    t = minutes * 60
    pm = div(C * 1000, t) + div((div(t, 2) + restart) * 1000, mtbf)
    print(f"every {str(minutes).rjust(3)} min: overhead {f1(pm)}%")
print(f"write {C} s, cluster MTBF {mtbf} s, best interval about {math.floor(math.sqrt(2 * C * mtbf))} s")
