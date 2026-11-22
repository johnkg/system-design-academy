// Hash vs MAC vs signature, in a toy model. WARNING: the "hash" below is a 32-bit FNV-1a, a STAND-IN so that every language
// prints the same numbers. It is NOT secure, and neither are the 4-byte tags or the textbook RSA with tiny primes.
// The point is the structure: what each construction lets an attacker do, not the strength of the numbers.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static List<int> Bytes(string s) => s.Select(c => (int)c).ToList();

    // The output of this hash is its internal state, with no final step. That is the property length extension needs.
    static uint Step(uint h, IEnumerable<int> bs)
    {
        foreach (var b in bs) { h ^= (uint)b; h = unchecked(h * 16777619u); }
        return h;
    }
    static uint H(IEnumerable<int> bs) => Step(2166136261u, bs);
    static string Hex(uint h) => h.ToString("x8");
    static string Yn(bool b) => b ? "yes" : "no";
    static List<int> Be(uint x) => new() { (int)(x >> 24), (int)((x >> 16) & 255), (int)((x >> 8) & 255), (int)(x & 255) };

    // HMAC: the real construction (an inner and an outer hash, with the key mixed in twice), over the toy hash. Block size 16.
    static uint Hmac(string key, string msg)
    {
        var k = Bytes(key); while (k.Count < 16) k.Add(0);
        uint inner = H(k.Select(b => b ^ 0x36).Concat(Bytes(msg)));
        return H(k.Select(b => b ^ 0x5c).Concat(Be(inner)));
    }
    static uint NaiveMac(string secret, string msg) => H(Bytes(secret + msg)); // hash(secret + message): NOT an HMAC

    // Textbook RSA with tiny primes (61 * 53): the public key is (3233, 17), the private exponent is 2753.
    const int N = 3233, E = 17, D = 2753;
    static int ModPow(int b, int e, int m) { int r = 1; b %= m; while (e > 0) { if ((e & 1) == 1) r = r * b % m; b = b * b % m; e >>= 1; } return r; }
    static int Sign(string msg) => ModPow((int)(H(Bytes(msg)) % N), D, N);                           // needs the private exponent
    static bool VerifySig(string msg, int sig) => ModPow(sig, E, N) == (int)(H(Bytes(msg)) % N);      // needs only the public key

    const string Secret = "k3y-s3cret", Body = "id=evt77&order=1001&amount=500", Edited = "id=evt77&order=1001&amount=9999";
    static bool OkHash(string body, uint h) => H(Bytes(body)) == h;
    static bool OkHmac(string body, uint t) => Hmac(Secret, body) == t;

    static (bool Ok, int N) Early(List<int> a, List<int> b)
    {
        int n = 0;
        for (int i = 0; i < a.Count; i++) { n++; if (a[i] != b[i]) return (false, n); }
        return (true, n);
    }
    static (bool Ok, int N) Constant(List<int> a, List<int> b)
    {
        int diff = 0;
        for (int i = 0; i < a.Count; i++) diff |= a[i] ^ b[i];
        return (diff == 0, a.Count);
    }

    static (bool Done, int Guesses, uint Tag) Recover(Func<List<int>, List<int>, (bool Ok, int N)> compare, List<int> target)
    {
        var known = new List<int>(); int guesses = 0;
        for (int i = 0; i < 4; i++)
        {
            int best = -1, bestScore = -1, first = -1; bool same = true;
            for (int v = 0; v < 256; v++)
            {
                var g = known.Concat(new[] { v, 0, 0, 0 }).Take(4).ToList(); guesses++;
                var r = compare(g, target); int score = r.Ok ? 99 : r.N;
                if (first < 0) first = score;
                if (score != first) same = false;
                if (score > bestScore) { bestScore = score; best = v; }
            }
            if (same) return (false, guesses, 0);
            known.Add(best);
        }
        uint t = 0; foreach (var b in known) t = t * 256 + (uint)b;
        return (true, guesses, t);
    }

    // window = seconds a timestamp may be old (0 = not checked), remember = keep the ids already seen, covers = the signature covers the timestamp.
    static void ReplayRun(string label, int window, bool remember, bool covers)
    {
        string SignedText(int ts, string body) => covers ? $"{ts}.{body}" : body;
        var seen = new HashSet<string>(); int credited = 0;
        string Receive(int now, int ts, string body, uint s)
        {
            if (Hmac(Secret, SignedText(ts, body)) != s) return "rejected: bad signature";
            if (window > 0 && now - ts > window) return "rejected: too old";
            if (remember) { if (seen.Contains("evt77")) return "rejected: already processed"; seen.Add("evt77"); }
            credited++; return "accepted";
        }
        uint s0 = Hmac(Secret, SignedText(1000, Body));
        var o = new List<string>();
        o.Add($"first delivery {Receive(1000, 1000, Body, s0)}");
        o.Add($"replay after 10 s {Receive(1010, 1000, Body, s0)}");
        o.Add($"replay after 600 s {Receive(1600, 1000, Body, s0)}");
        o.Add($"replay after 600 s with a fresh timestamp {Receive(1600, 1600, Body, s0)}");
        Console.WriteLine($"{label}: {string.Join("; ", o)}. Times credited: {credited}.");
    }

    public static void Main()
    {
        Console.WriteLine("-- 1. a plain hash: integrity against accidents, nothing about who");
        Console.WriteLine($"hash(body) = {Hex(H(Bytes(Body)))}");
        Console.WriteLine($"attacker edits the amount and sends the hash of the edited body: server accepts = {Yn(OkHash(Edited, H(Bytes(Edited))))}");

        Console.WriteLine("-- 2. HMAC: only a holder of the key can make a tag");
        uint tag = Hmac(Secret, Body);
        Console.WriteLine($"hmac(key, body) = {Hex(tag)}");
        Console.WriteLine($"edited body with the old tag: server accepts = {Yn(OkHmac(Edited, tag))}");
        Console.WriteLine($"edited body with a tag made from a guessed key: server accepts = {Yn(OkHmac(Edited, Hmac("guess", Edited)))}");

        Console.WriteLine("-- 3. length extension: hash(secret + message) is not an HMAC");
        const string extra = "&amount=9999";
        uint nTag = NaiveMac(Secret, Body);
        uint forgedTag = Step(nTag, Bytes(extra)); // the attacker never sees the secret: they just keep hashing from the tag
        Console.WriteLine($"naive tag of the original = {Hex(nTag)}; forged tag for body + \"{extra}\" = {Hex(forgedTag)}");
        Console.WriteLine($"server recomputes hash(secret + longer body): accepts = {Yn(NaiveMac(Secret, Body + extra) == forgedTag)}");
        Console.WriteLine($"same trick on the HMAC tag: accepts = {Yn(Hmac(Secret, Body + extra) == Step(tag, Bytes(extra)))}");

        Console.WriteLine("-- 4. non-repudiation: who could have made this message?");
        const string mine = "id=evt78&order=1002&amount=1";
        Console.WriteLine($"receiver makes its own message with the shared HMAC key: verifies = {Yn(OkHmac(mine, Hmac(Secret, mine)))} (so the tag cannot prove the sender made it)");
        int sig = Sign(Body);
        Console.WriteLine($"signature of the body = {sig}; verifies with the public key = {Yn(VerifySig(Body, sig))}");
        Console.WriteLine($"receiver signs its own message without the private exponent (best guess 1234): verifies = {Yn(VerifySig(mine, 1234))}");
        Console.WriteLine($"edited body with the old signature: verifies = {Yn(VerifySig(Edited, sig))}");

        Console.WriteLine("-- 5. comparing tags: early exit leaks, constant time does not (comparisons stand in for time)");
        var target = Be(tag);
        var modes = new (string, Func<List<int>, List<int>, (bool Ok, int N)>)[] { ("early exit", Early), ("constant time", Constant) };
        foreach (var (name, cmp) in modes)
        {
            var r = Recover(cmp, target);
            Console.WriteLine($"{name}: " + (r.Done ? $"tag {Hex(r.Tag)} recovered in {r.Guesses} guesses (brute force: 4294967296 possible tags)" : $"no signal after {r.Guesses} guesses: every guess costs the same"));
        }

        Console.WriteLine("-- 6. replay: a captured, correctly signed webhook sent again");
        ReplayRun("no checks", 0, false, true);
        ReplayRun("300 s window only", 300, false, true);
        ReplayRun("300 s window and seen ids", 300, true, true);
        ReplayRun("window only, timestamp not signed", 300, false, false);
    }
}
