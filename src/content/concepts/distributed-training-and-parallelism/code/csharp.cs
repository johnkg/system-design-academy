// Memory per GPU, step time and checkpoint cost for distributed training, using integer arithmetic only.
// Assumptions: mixed-precision Adam = 16 bytes per parameter (2 weights + 2 gradients + 12 optimizer), 50% kernel
// efficiency of a 400 TFLOP/s GPU, 8 GPUs per node, 300 GB/s inside a node, 4096-token microbatches.
using System;
using System.Linq;

public static class Program
{
    static long Div(long a, long b) => (a + b / 2) / b; // integer division, rounded
    static string F1(long x10) => $"{x10 / 10}.{x10 % 10}"; // tenths -> text

    record Plan(long Total, bool Fits, long Step, long Comm, long Bub, long Mfu);

    static Plan Make(int P, int N, int memGB, int stage, int tp, int pp, int m, int interGBps)
    {
        // billions of parameters -> (layers, hidden size)
        long L = P == 7 ? 32 : 80, h = P == 7 ? 4096 : 8192;
        long mp = tp * pp, dp = N / mp;
        long w = Div(20 * P, mp * (stage >= 3 ? dp : 1)); // GB x 10
        long g = Div(20 * P, mp * (stage >= 2 ? dp : 1));
        long o = Div(120 * P, mp * (stage >= 1 ? dp : 1));
        long a = Div(5 * P, tp), total = w + g + o + a + 40; // activations + 4 GB fixed overhead
        long comp = Div(6L * P * m * 4096, mp * 200); // ms of compute per step
        long bubble = Div(comp * (pp - 1), m); // idle ms: (pp-1)/m of the compute time
        long tpMs = tp > 1 ? Div(L * m * 4 * 2 * (tp - 1) * 4096 * h * 2, tp * pp * (tp <= 8 ? 300 : interGBps) * 1000000L) : 0;
        long grad = Div(2L * P * 1000000000L, mp); // gradient bytes held by one model replica shard
        long dpBytes = Div((stage >= 3 ? 3 : 2) * (dp - 1) * grad, dp); // ring: 2(d-1)/d x G, ZeRO-3 adds an all-gather
        long dpMs = dp > 1 ? Div(dpBytes, (N <= 8 ? 300 : interGBps) * 1000000L) : 0;
        long dpExposed = Math.Max(0, dpMs - Div(2 * comp, 3)); // hidden behind the backward pass (2/3 of compute)
        long step = comp + bubble + tpMs + dpExposed;
        return new Plan(total, total <= memGB * 10L, step, Div((tpMs + dpExposed) * 1000, step),
            Div(bubble * 1000, step), Div(Div(6L * P * m * 4096, mp * 400) * 1000, step));
    }

    public static void Main()
    {
        Console.WriteLine("memory per GPU, 70B model on 64 GPUs of 80 GB, 8 microbatches");
        var configs = new (string, int, int, int, int)[] { ("plain data parallel", 0, 1, 1, 8), ("ZeRO-3 / FSDP", 3, 1, 1, 8),
            ("ZeRO-3, 1 microbatch", 3, 1, 1, 1), ("TP 8 + ZeRO-1", 1, 8, 1, 8), ("TP 16 + ZeRO-1", 1, 16, 1, 8),
            ("PP 8 + ZeRO-1", 1, 1, 8, 8), ("TP 4 x PP 4 + ZeRO-1", 1, 4, 4, 16) };
        long lastTotal = -1;
        foreach (var (name, stage, tp, pp, m) in configs)
        {
            var r = Make(70, 64, 80, stage, tp, pp, m, 25);
            Console.WriteLine($"{name.PadRight(22)} {F1(r.Total).PadLeft(6)} GB {(r.Fits ? "fits" : "OOM ")} step {r.Step.ToString().PadLeft(6)} ms comm {F1(r.Comm)}% bubble {F1(r.Bub)}% MFU {F1(r.Mfu)}%");
            if (lastTotal >= 0 && name == "ZeRO-3 / FSDP" && !(r.Total < lastTotal)) Environment.Exit(1);
            lastTotal = r.Total;
        }
        var s = Enumerable.Range(0, 4).Select(st => Make(70, 64, 80, st, 1, 1, 8, 25).Total).ToArray();
        for (int i = 1; i < 4; i++) if (!(s[i] < s[i - 1])) Environment.Exit(1);

        Console.WriteLine("ring all-reduce of 1 GB of gradients (per GPU sends 2(d-1)/d of it, in 2(d-1) steps)");
        foreach (int d in new[] { 2, 8, 64, 512 })
        {
            long sent = Div(2L * (d - 1) * 1000, d); // MB sent per GPU
            Console.WriteLine($"d={d.ToString().PadLeft(3)} steps {(2 * (d - 1)).ToString().PadLeft(4)} sent {sent} MB");
            if (sent >= 2000 || sent < 1000) Environment.Exit(1);
        }

        Console.WriteLine("pipeline bubble, 8 stages: idle share = (p-1)/(m+p-1)");
        long prev = 1001;
        foreach (int m in new[] { 1, 4, 8, 32, 64 })
        {
            long pm = Div(7 * 1000, m + 7);
            Console.WriteLine($"m={m.ToString().PadLeft(2)} idle {F1(pm)}%");
            if (!(pm < prev)) Environment.Exit(1);
            prev = pm;
        }

        Console.WriteLine("checkpoint interval, 70B model, 4096 GPUs, 50000 h per-GPU MTBF, 10 min restart, 50 GB/s checkpoint write");
        long C = Div(14 * 70, 50), mtbf = Div(50000L * 3600, 4096), restart = 600; // seconds
        foreach (int min in new[] { 5, 15, 60, 240 })
        {
            long t = min * 60;
            long pm = Div(C * 1000, t) + Div((Div(t, 2) + restart) * 1000, mtbf);
            Console.WriteLine($"every {min.ToString().PadLeft(3)} min: overhead {F1(pm)}%");
        }
        Console.WriteLine($"write {C} s, cluster MTBF {mtbf} s, best interval about {(long)Math.Floor(Math.Sqrt(2.0 * C * mtbf))} s");
    }
}
