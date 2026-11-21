// A chained hash table with a fixed number of buckets and a selectable hash function. A probe is one key compared
// while walking a chain. Inserts check the chain for the key first, then append; lookups walk until they find it.
// Look for: a good hash keeps chains short, so a lookup costs about 1 probe; a poor or constant hash, or keys an attacker
// chose to collide, put everything in a few chains and the cost becomes O(n) per lookup, O(n^2) in total.
// The chain walks use the language's own linear scan (Contains / IndexOf): a scan is exactly position + 1 comparisons.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const uint Mult = 2654435761;     // Knuth's multiplicative constant (odd, so multiplying mod 2^32 is reversible)
    const uint MultInv = 244002641;   // its inverse mod 2^32: an attacker uses it to craft colliding keys
    const uint Mix = 2246822519;      // a second odd multiplier for the seeded hash's mixing steps
    const uint Seed = 2718281828;     // the secret a randomised hash would pick at start-up (a fixed stand-in so the output repeats)

    static int BucketOf(string fn, uint key, int m)
    {
        unchecked
        {
            if (fn == "constant") return 0;
            if (fn == "poor") return (int)((key % 10) % (uint)m); // looks only at the last decimal digit
            if (fn == "seeded") // a keyed, better-mixed hash: a stand-in for what SipHash-style hashes do with a secret key
            {
                uint x = key ^ Seed;
                x *= Mult;
                x ^= x >> 15;
                x *= Mix;
                x ^= x >> 13;
                return (int)((x >> 16) % (uint)m);
            }
            uint h = key * Mult; // multiplicative hash mod 2^32
            return (int)((h / 65536) % (uint)m); // use the high 16 bits, which mix best
        }
    }

    static List<uint> MakeKeys(string pattern, string fn, int n)
    {
        var keys = new List<uint>();
        uint x = 12345;
        for (uint i = 0; i < n; i++)
        {
            unchecked
            {
                if (pattern == "random") { x = x * 1664525 + 1013904223; keys.Add(x); }
                else if (pattern == "sequential") keys.Add(i);
                else if (fn == "poor") keys.Add(i * 10);          // adversarial for a last-digit hash: every key ends in 0
                else if (fn == "constant") keys.Add(i);           // anything collides with a constant hash
                else keys.Add(i * MultInv);                       // crafted so the UNSEEDED hash of key i is i, high bits 0: bucket 0
            }
        }
        return keys;
    }

    static string Run(string fn, string pattern, int n, int m)
    {
        var buckets = Enumerable.Range(0, m).Select(_ => new List<uint>()).ToArray();
        var keys = MakeKeys(pattern, fn, n);
        long insertProbes = 0, lookupProbes = 0;
        foreach (var k in keys)
        {
            var chain = buckets[BucketOf(fn, k, m)];
            if (chain.Contains(k)) throw new Exception("duplicate key");
            insertProbes += chain.Count; // the walk that found no match
            chain.Add(k);
        }
        foreach (var k in keys) lookupProbes += buckets[BucketOf(fn, k, m)].IndexOf(k) + 1;
        long total = insertProbes + lookupProbes;
        var lens = buckets.Select(b => (long)b.Count).ToArray();
        if (total != lens.Sum(l => l * l)) throw new Exception("model mismatch"); // inserts l(l-1)/2 + lookups l(l+1)/2
        long avg = lookupProbes * 100 / n;
        return $"longest chain {lens.Max()}, buckets used {lens.Count(l => l > 0)} of {m}, {avg / 100}.{(avg % 100).ToString().PadLeft(2, '0')} probes per lookup, {total} probes in total";
    }

    public static void Main()
    {
        var scenarios = new[]
        {
            ("good hash, random keys", "good", "random"),
            ("good hash, sequential keys", "good", "sequential"),
            ("poor hash (last digit), sequential keys", "poor", "sequential"),
            ("constant hash, sequential keys", "constant", "sequential"),
            ("good hash, attacker keys", "good", "adversarial"),
            ("seeded hash, attacker keys", "seeded", "adversarial"),
            ("poor hash (last digit), attacker keys", "poor", "adversarial"),
        };
        foreach (var (n, m) in new[] { (100, 128), (10000, 16384) })
        {
            Console.WriteLine($"n={n} keys, {m} buckets (load factor {n * 100 / m}%)");
            foreach (var (name, fn, pattern) in scenarios) Console.WriteLine($"  {name}: {Run(fn, pattern, n, m)}");
        }
    }
}
