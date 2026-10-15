// KV cache memory and a decode-step latency model for one 8B-class model on one 80 GB GPU.
// All math is integer so the output is identical in every language. Constants are stated assumptions, not vendor numbers.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long Layers = 32, HeadDim = 128;
    const long Weights = 16_000_000_000;           // 8e9 parameters x 2 bytes (fp16)
    const long GpuBytes = 80_000_000_000;
    const long Usable = GpuBytes * 9 / 10;         // keep 10% for activations, CUDA context, fragmentation
    const long BwBytesPerUs = 2_000_000;           // 2 TB/s memory bandwidth
    const long FlopsPerUs = 200_000_000;           // 200 TFLOP/s achievable
    const long FlopsPerToken = 16_000_000_000;     // 2 x parameters per generated token
    const long MaxBatch = 256;

    // 2 (K and V) x layers x kv_heads x head_dim x bytes per value
    static long KvBytesPerToken(long kvHeads, long bits) => 2 * Layers * kvHeads * HeadDim * bits / 8;
    static long MaxSequences(long kvPerToken, long ctx) => Math.Min(MaxBatch, (Usable - Weights) / (kvPerToken * ctx));

    // One decode step reads every weight once plus every sequence's whole KV cache.
    static (long us, string bound) DecodeStepUs(long batch, long kvPerToken, long ctx)
    {
        long memoryUs = (Weights + batch * kvPerToken * ctx) / BwBytesPerUs;
        long computeUs = batch * FlopsPerToken / FlopsPerUs;
        return (Math.Max(memoryUs, computeUs), memoryUs >= computeUs ? "memory" : "compute");
    }
    static long PrefillMs(long ctx) => ctx * FlopsPerToken / FlopsPerUs / 1000;
    static void Check(bool ok, string msg) { if (!ok) { Console.Error.WriteLine("invariant violated: " + msg); Environment.Exit(1); } }

    public static void Main()
    {
        var configs = new (string name, long heads, long bits, long ctx)[]
        {
            ("MHA-32 fp16", 32, 16, 8192), ("GQA-8  fp16", 8, 16, 8192), ("GQA-8  fp8 ", 8, 8, 8192),
            ("GQA-8  int4", 8, 4, 8192), ("MQA-1  fp16", 1, 16, 8192), ("GQA-8  fp16", 8, 16, 32768),
            ("GQA-8  fp16", 8, 16, 131072),
        };
        var results = new List<(long n, long s1, long sn)>();
        foreach (var (name, heads, bits, ctx) in configs)
        {
            long kvt = KvBytesPerToken(heads, bits), n = MaxSequences(kvt, ctx);
            long s1 = DecodeStepUs(1, kvt, ctx).us;
            string line = $"{name} ctx={ctx,6} kv/token={kvt,6}B kv/seq={kvt * ctx / 1_000_000,5}MB max_seqs={n,3} ttft={PrefillMs(ctx),5}ms step1={s1,5}us tps1={1_000_000 / s1,4}";
            long sn = 0;
            if (n >= 1)
            {
                var (us, bound) = DecodeStepUs(n, kvt, ctx);
                sn = us;
                line += $" stepN={sn,6}us tpsN={n * 1_000_000 / sn,5} {bound}-bound";
                results.Add((n, s1, sn));
            }
            Console.WriteLine(line);
        }

        // Invariants: GQA-8 is 4x smaller than MHA-32; fp8 halves it again; a longer context never fits more sequences.
        Check(KvBytesPerToken(32, 16) == 4 * KvBytesPerToken(8, 16) && KvBytesPerToken(32, 16) == 524288, "GQA is 4x smaller");
        Check(KvBytesPerToken(8, 8) * 2 == KvBytesPerToken(8, 16), "fp8 halves the cache");
        Check(MaxSequences(131072, 8192) > MaxSequences(131072, 32768) && MaxSequences(131072, 32768) > MaxSequences(131072, 131072), "longer context fits fewer");
        Check(results.All(r => r.s1 >= Weights / BwBytesPerUs), "a step cannot beat reading the weights");
        long mhaN = results[0].n, gqaN = results[1].n;
        Check(gqaN > 3 * mhaN && results[1].sn > 0, "GQA serves more sequences");
        Console.WriteLine($"GQA-8 serves {gqaN} sequences where MHA-32 serves {mhaN}");
    }
}
