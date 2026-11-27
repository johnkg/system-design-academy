// Counting trainable weights in C#: full fine-tuning of one d x d matrix against a LoRA update of rank r.
using System;
using System.Globalization;

public static class Program
{
    public static void Main()
    {
        const long d = 4096;
        const long bytesPerTrainableWeight = 16; // 16-bit weight + 16-bit gradient + 32-bit weight copy, momentum and variance, as in the ZeRO accounting

        var full = d * d;
        Console.WriteLine($"full matrix: {d} x {d} = {full} trainable weights");
        foreach (var rank in new long[] { 8, 64 })
        {
            var lora = 2 * d * rank; // B is d x r and A is r x d
            var percent = (100.0 * lora / full).ToString("F3", CultureInfo.InvariantCulture);
            Console.WriteLine($"LoRA rank {rank}: 2 x {d} x {rank} = {lora} trainable weights ({percent}%)");
        }

        const long mib = 1024 * 1024;
        Console.WriteLine($"training state: {full * bytesPerTrainableWeight / mib} MiB for full tuning, " +
            $"{2 * d * 8 * bytesPerTrainableWeight / mib} MiB for LoRA rank 8 (16 bytes per trainable weight)");
    }
}
