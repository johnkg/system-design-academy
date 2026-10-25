// Probabilistic data structures for a web crawler: a Bloom filter for "seen this URL?", HyperLogLog for "how many distinct
// URLs did the shards find?" and a count-min sketch for "which hosts get the most links?". Deterministic: fixed hashes, no randomness.
using System;
using System.Globalization;
using System.Linq;
using System.Numerics;

public static class Program
{
    const int NUrls = 10000, TestUrls = 20000, UrlBytes = 100;
    const double TargetFp = 0.01;
    const int HllBits = 14, Shards = 4, Distinct = 200000;
    const int CmRows = 4, CmWidth = 272, Hosts = 1000, TopLinks = 20000; // width = e / 0.01, so the error is at most 1% of all links
    const uint Golden = 0x9e3779b9;

    // 32-bit FNV-1a over the URL's characters (all ASCII), then the MurmurHash3 finalizer to spread the bits.
    static uint Fnv1a(string s)
    {
        uint h = 0x811c9dc5;
        foreach (char c in s) h = unchecked((h ^ c) * 0x01000193);
        return h;
    }

    static uint Fmix(uint h)
    {
        unchecked
        {
            h ^= h >> 16; h *= 0x85ebca6b;
            h ^= h >> 13; h *= 0xc2b2ae35;
            return h ^ (h >> 16);
        }
    }

    static uint HashI(uint h, int i) => Fmix(unchecked(h + (uint)(i + 1) * Golden)); // the i-th of several hashes of one key
    static string Url(int i) => $"https://site{i % 500}.example/page/{i}";
    static string Pct(double x) => (100 * x).ToString("F2", CultureInfo.InvariantCulture) + "%";

    // --- Bloom filter: m bits, k hashes. "Definitely new" if any bit is 0, "probably seen" if all are 1.
    sealed class Bloom(int m, int k)
    {
        readonly bool[] bits = new bool[m];
        public void Add(string key) { uint h = Fnv1a(key); for (int i = 0; i < k; i++) bits[HashI(h, i) % (uint)m] = true; }
        public bool MightContain(string key)
        {
            uint h = Fnv1a(key);
            for (int i = 0; i < k; i++) if (!bits[HashI(h, i) % (uint)m]) return false; // a 0 bit: never added
            return true;
        }
    }

    static (int Fn, int Fp, double Formula) BloomRun(int n, int m, int k)
    {
        var f = new Bloom(m, k);
        for (int i = 0; i < n; i++) f.Add(Url(i));
        int fn = 0, fp = 0;
        for (int i = 0; i < n; i++) if (!f.MightContain(Url(i))) fn++;
        for (int i = 0; i < TestUrls; i++) if (f.MightContain(Url(1000000 + i))) fp++; // URLs that were never added
        return (fn, fp, Math.Pow(1 - Math.Exp(-(double)k * n / m), k));
    }

    // --- HyperLogLog: 2^14 registers; each keeps the longest run of leading zeros (plus one) among the hashes routed to it.
    sealed class Hll(int p)
    {
        public readonly int M = 1 << p;
        public readonly byte[] Reg = new byte[1 << p];
        public void Add(string key)
        {
            uint h = Fmix(Fnv1a(key) ^ 0x5bd1e995);
            int j = (int)(h >> (32 - p)); // the first p bits pick the register
            uint rest = h << p;
            int rank = Math.Min(BitOperations.LeadingZeroCount(rest) + 1, 32 - p + 1);
            if (rank > Reg[j]) Reg[j] = (byte)rank;
        }
        public void Merge(Hll other) { for (int j = 0; j < M; j++) if (other.Reg[j] > Reg[j]) Reg[j] = other.Reg[j]; } // max per register
        public long Estimate()
        {
            double alpha = 0.7213 / (1 + 1.079 / M), sum = 0;
            int zeros = 0;
            for (int j = 0; j < M; j++) { sum += Math.Pow(2, -Reg[j]); if (Reg[j] == 0) zeros++; }
            double e = alpha * M * M / sum;
            if (e <= 2.5 * M && zeros > 0) e = M * Math.Log((double)M / zeros); // small counts: linear counting
            return (long)Math.Floor(e + 0.5);
        }
    }

    static string Host(int j) => $"host{j}.example";
    static int TrueLinks(int j) => TopLinks / (j + 1); // a few hosts get most links (a Zipf-like spread)

    public static void Main()
    {
        int m = (int)Math.Ceiling(-NUrls * Math.Log(TargetFp) / (Math.Log(2) * Math.Log(2))); // m = -n ln p / (ln 2)^2
        int k = (int)Math.Round((double)m / NUrls * Math.Log(2), MidpointRounding.AwayFromZero); // k = (m / n) ln 2
        var b = BloomRun(NUrls, m, k);
        Console.WriteLine($"Bloom filter: {NUrls} URLs, m={m} bits ({(m + 7) / 8} bytes, {((double)m / NUrls).ToString("F2", CultureInfo.InvariantCulture)} bits per URL), k={k}");
        Console.WriteLine($"  exact set would be about {NUrls * UrlBytes} bytes ({UrlBytes} bytes per URL)");
        Console.WriteLine($"  false negatives: {b.Fn} of {NUrls} inserted URLs");
        Console.WriteLine($"  false positives: {b.Fp} of {TestUrls} new URLs = {Pct((double)b.Fp / TestUrls)} (formula {Pct(b.Formula)})");
        var over = BloomRun(2 * NUrls, m, k); // same size, twice the planned URLs
        Console.WriteLine($"  overfilled with {2 * NUrls} URLs: false positives {Pct((double)over.Fp / TestUrls)} (formula {Pct(over.Formula)})");

        var shards = Enumerable.Range(0, Shards).Select(_ => new Hll(HllBits)).ToArray();
        for (int i = 0; i < Distinct; i++)
        {
            shards[i % Shards].Add(Url(i));
            if (i % 3 == 0) shards[(i + 1) % Shards].Add(Url(i)); // a third of the URLs are also found by a second shard
        }
        Console.WriteLine($"HyperLogLog: {1 << HllBits} registers, {(1 << HllBits) * 6 / 8} bytes each, standard error {Pct(1.04 / Math.Sqrt(1 << HllBits))}");
        long sumOfShards = 0;
        for (int i = 0; i < Shards; i++)
        {
            long e = shards[i].Estimate();
            sumOfShards += e;
            Console.WriteLine($"  shard {i + 1}: about {e} distinct URLs");
        }
        Console.WriteLine($"  adding the shard counts: {sumOfShards} (URLs found by two shards are counted twice)");
        var merged = new Hll(HllBits);
        foreach (var s in shards) merged.Merge(s);
        long est = merged.Estimate();
        Console.WriteLine($"  merged sketch: {est}, true {Distinct}, error {Pct((double)(est - Distinct) / Distinct)}");

        // --- Count-min sketch: CmRows rows of CmWidth counters, one hash per row. The estimate is the smallest counter.
        var cm = new long[CmRows, CmWidth];
        long total = 0;
        for (int j = 0; j < Hosts; j++)
        {
            uint h = Fnv1a(Host(j)); int c = TrueLinks(j);
            for (int r = 0; r < CmRows; r++) cm[r, HashI(h, r) % CmWidth] += c; // same as adding 1 per link, c times
            total += c;
        }
        long CmEstimate(string name)
        {
            uint h = Fnv1a(name); long best = long.MaxValue;
            for (int r = 0; r < CmRows; r++) best = Math.Min(best, cm[r, HashI(h, r) % CmWidth]);
            return best;
        }
        Console.WriteLine($"Count-min: {CmRows} rows x {CmWidth} counters, {total} links, error bound 1% of links = {total / 100}");
        int under = 0; long maxOver = 0;
        for (int j = 0; j < Hosts; j++) { long d = CmEstimate(Host(j)) - TrueLinks(j); if (d < 0) under++; if (d > maxOver) maxOver = d; }
        foreach (int j in new[] { 0, 1, 2, 999 }) Console.WriteLine($"  {Host(j)}: true {TrueLinks(j)}, estimate {CmEstimate(Host(j))}");
        Console.WriteLine($"  underestimates: {under}, largest overestimate: {maxOver}");
    }
}
