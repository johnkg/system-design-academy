// A tiny time-series database in C#:
// Gorilla compression (delta-of-delta timestamps, XOR floats) plus an inverted index from labels to series ids.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;

public record Point(long T, double V);
public record Block(int N, List<int> Bits);

public class BitWriter
{
    public readonly List<int> Bits = new();
    public void Put(ulong value, int n) { for (int i = n - 1; i >= 0; i--) Bits.Add((int)((value >> i) & 1)); }
}

public class BitReader
{
    readonly List<int> bits; int pos;
    public BitReader(List<int> bits) { this.bits = bits; }
    public ulong Get(int n) { ulong v = 0; for (int i = 0; i < n; i++) v = (v << 1) | (uint)bits[pos++]; return v; }
}

public static class Gorilla
{
    // A delta-of-delta fits one of three small buckets (tag, tag bits, number of bits), or falls back to 32 bits.
    static readonly (ulong Tag, int TagBits, int Bits)[] Buckets = { (0b10, 2, 7), (0b110, 3, 9), (0b1110, 4, 12) };
    static long Bias(int bits) => (1L << (bits - 1)) - 1;
    static ulong ToBits(double x) => BitConverter.DoubleToUInt64Bits(x);
    static double FromBits(ulong b) => BitConverter.UInt64BitsToDouble(b);

    static void PutDod(BitWriter w, long d)
    {
        if (d == 0) { w.Put(0, 1); return; } // a steady scrape interval costs one bit
        foreach (var b in Buckets)
            if (d >= -Bias(b.Bits) && d <= Bias(b.Bits) + 1) { w.Put(b.Tag, b.TagBits); w.Put((ulong)(d + Bias(b.Bits)), b.Bits); return; }
        w.Put(0b1111, 4); w.Put((ulong)(d + (1L << 31)), 32);
    }

    static long GetDod(BitReader r)
    {
        if (r.Get(1) == 0) return 0;
        int k = 0;
        while (k < 3 && r.Get(1) == 1) k++;
        if (k == 3) return (long)r.Get(32) - (1L << 31);
        return (long)r.Get(Buckets[k].Bits) - Bias(Buckets[k].Bits);
    }

    public static List<int> Compress(List<Point> points)
    {
        var w = new BitWriter();
        w.Put((ulong)points[0].T, 32); w.Put(ToBits(points[0].V), 64);
        long prevT = points[0].T, prevDelta = 0; ulong prev = ToBits(points[0].V); int lead = -1, len = 0;
        foreach (var p in points.Skip(1))
        {
            PutDod(w, p.T - prevT - prevDelta); prevDelta = p.T - prevT; prevT = p.T;
            ulong bits = ToBits(p.V), x = bits ^ prev; prev = bits;
            if (x == 0) { w.Put(0, 1); continue; } // same value as before: one bit
            int l = Math.Min(BitOperations.LeadingZeroCount(x), 31), tz = BitOperations.TrailingZeroCount(x);
            if (lead >= 0 && l >= lead && tz >= 64 - lead - len) { w.Put(0b10, 2); w.Put(x >> (64 - lead - len), len); } // fits the previous window
            else { int m = 64 - l - tz; w.Put(0b11, 2); w.Put((ulong)l, 5); w.Put((ulong)(m - 1), 6); w.Put(x >> tz, m); lead = l; len = m; }
        }
        return w.Bits;
    }

    public static List<Point> Decompress(List<int> bits, int n)
    {
        var r = new BitReader(bits);
        long t = (long)r.Get(32), delta = 0; ulong prev = r.Get(64); int lead = 0, len = 0;
        var outList = new List<Point> { new(t, FromBits(prev)) };
        while (outList.Count < n)
        {
            delta += GetDod(r); t += delta;
            if (r.Get(1) == 1)
            {
                if (r.Get(1) == 1) { lead = (int)r.Get(5); len = (int)r.Get(6) + 1; }
                prev ^= r.Get(len) << (64 - lead - len);
            }
            outList.Add(new(t, FromBits(prev)));
        }
        return outList;
    }
}

public static class Program
{
    static readonly List<Dictionary<string, string>> series = new();
    static readonly Dictionary<string, List<int>> postings = new(); // "label=value" -> sorted series ids
    static readonly List<Block> blocks = new();

    static void AddSeries(Dictionary<string, string> labels, List<Point> points)
    {
        int id = series.Count; series.Add(labels);
        foreach (var (k, v) in labels) { var key = $"{k}={v}"; if (!postings.ContainsKey(key)) postings[key] = new(); postings[key].Add(id); }
        blocks.Add(new Block(points.Count, Gorilla.Compress(points)));
    }

    static List<int> Intersect(List<int> a, List<int> b)
    {
        var o = new List<int>(); int i = 0, j = 0;
        while (i < a.Count && j < b.Count) { if (a[i] == b[j]) { o.Add(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; }
        return o;
    }

    static List<int> Select(string[] matchers) =>
        matchers.Select(m => postings.GetValueOrDefault(m) ?? new List<int>()).OrderBy(l => l.Count).Aggregate(Intersect);

    const int Series = 8; // hosts h0..h7
    const int Points = 120; // points per series
    const int BaseValue = 50; // host h starts at 50 + h
    const double ValueStep = 0.25; // a changing scrape moves the value by one step
    const int ScrapeS = 10; // seconds between scrapes
    const int JitterOneIn = 8; // one scrape in 8 lands a second late
    const int WebHosts = 5; // h0..h4 are web, the rest db
    const int QueryFrom = 300; // the range query covers T0+300 .. T0+599
    const int QueryTo = 600;
    const int MaxBitsPerPoint = 40; // compression must do better than this
    static uint seed = 7;
    static int Random(int n) { seed = unchecked(seed * 1664525 + 1013904223); return (int)((seed / 65536) % n); }
    static string F2(double x) => x.ToString("F2", CultureInfo.InvariantCulture);

    public static int Main()
    {
        const long T0 = 1700000000; var raw = new List<List<Point>>();
        for (int h = 0; h < Series; h++)
        {
            double v = BaseValue + h; var points = new List<Point>();
            for (int i = 0; i < Points; i++)
            {
                if (Random(2) == 0) v += (Random(3) - 1) * ValueStep; // half the scrapes see no change
                points.Add(new Point(T0 + i * ScrapeS + (Random(JitterOneIn) == 0 ? 1 : 0), v));
            }
            raw.Add(points);
            AddSeries(new() { ["__name__"] = "cpu", ["host"] = $"h{h}", ["region"] = h % 2 == 0 ? "eu" : "us", ["tier"] = h < WebHosts ? "web" : "db" }, points);
        }

        long total = blocks.Sum(b => (long)b.Bits.Count), count = raw.Count * Points;
        Console.WriteLine($"{series.Count} series, {count} points, raw {count * 16} bytes");
        Console.WriteLine($"compressed {blocks.Sum(b => (b.Bits.Count + 7) / 8)} bytes, {F2((double)total / count)} bits per point");
        bool ok = blocks.Select((b, i) => Gorilla.Decompress(b.Bits, b.N).SequenceEqual(raw[i])).All(x => x);
        Console.WriteLine($"round trip exact: {ok.ToString().ToLower()}");

        var ids = Select(new[] { "__name__=cpu", "region=eu", "tier=web" });
        Console.WriteLine($"region=eu has [{string.Join(",", postings["region=eu"])}]; cpu, eu and web match series [{string.Join(",", ids)}]");
        double sum = 0; int hits = 0;
        foreach (int id in ids)
            foreach (var p in Gorilla.Decompress(blocks[id].Bits, blocks[id].N))
                if (p.T >= T0 + QueryFrom && p.T < T0 + QueryTo) { sum += p.V; hits++; }
        Console.WriteLine($"points in the range: {hits}, sum {F2(sum)}");
        return ok && string.Join(",", ids) == "0,2,4" && (double)total / count <= MaxBitsPerPoint ? 0 : 1;
    }
}
