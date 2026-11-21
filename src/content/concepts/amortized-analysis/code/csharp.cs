// Amortized analysis: a dynamic array that grows when it is full. The cost counted is element copies made by resizing.
// Look for: with doubling the average stays near 1 copy per append although one append copies tens of thousands of
// elements; growing by a constant makes the average climb with n; a shrink threshold at 1/2 thrashes at the boundary.
// Real runtimes pick their own growth factors (commonly somewhere between about 1.125x and 2x), so this is a model.
using System;
using System.Collections.Generic;

public static class Program
{
    static readonly Dictionary<string, Func<long, long>> Policies = new()
    {
        ["double"] = cap => cap * 2,
        ["x1.5"] = cap => Math.Max(cap + 1, cap + cap / 2),
        ["add 10"] = cap => cap + 10,
    };

    static string Fmt2(long total, long n) // total / n with two decimals, using integers only
    {
        long hundredths = total * 100 / n;
        return $"{hundredths / 100}.{(hundredths % 100).ToString().PadLeft(2, '0')}";
    }

    static (long Total, long Worst, long Resizes) AppendMany(string policy, long n)
    {
        long cap = 1, size = 0, total = 0, worst = 0, resizes = 0;
        for (long i = 0; i < n; i++)
        {
            long copies = 0;
            if (size == cap) { copies = size; cap = Policies[policy](cap); resizes++; } // allocate a bigger array, copy every element
            size++; // the append itself
            total += copies;
            if (copies > worst) worst = copies;
        }
        return (total, worst, resizes);
    }

    // Remove one item and append one item, repeatedly, starting just past a power of two. The shrink rule says when to halve the array.
    static long Thrash(string rule, long items, int cycles)
    {
        long div = rule == "never" ? 0 : rule == "half" ? 2 : 4;
        long cap = 1;
        while (cap < items) cap *= 2;
        long size = items, copies = 0;
        for (int c = 0; c < cycles; c++)
        {
            size--;
            if (div > 0 && size * div <= cap) { copies += size; cap /= 2; } // shrink: copy into an array half as big
            if (size == cap) { copies += size; cap *= 2; } // full again: grow
            size++;
        }
        return copies;
    }

    public static void Main()
    {
        foreach (long n in new long[] { 10, 1000, 100000 })
        {
            Console.WriteLine($"n={n}");
            foreach (var policy in new[] { "double", "x1.5", "add 10" })
            {
                var (total, worst, resizes) = AppendMany(policy, n);
                Console.WriteLine($"  {policy}: {total} copies in total, {Fmt2(total, n)} per append, worst single append {worst} copies, {resizes} resizes");
            }
        }
        foreach (var rule in new[] { "never", "half", "quarter" }) Console.WriteLine($"shrink rule {rule}: {Thrash(rule, 1025, 100)} copies in 100 remove-and-append cycles");
    }
}
