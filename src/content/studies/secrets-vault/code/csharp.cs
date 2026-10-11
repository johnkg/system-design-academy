// A tiny secrets vault in C#: Shamir-split master key, envelope encryption, policies with audit, master rotation, and leases.
// The cipher is a toy (XOR with a seeded stream) so the example stays short and deterministic. Never use it for real secrets.
using System;
using System.Collections.Generic;
using System.Linq;
using static Crypto;

var master0 = RandomBytes(16);
var shares = Split(master0, 5, 3);
Console.WriteLine($"share 1 starts with {string.Join(",", shares[0].Ys.Take(4))}");
bool allEqual = true;
for (int i = 0; i < 5; i++) for (int j = i + 1; j < 5; j++) for (int k = j + 1; k < 5; k++)
    allEqual = allEqual && Hex(Combine(new[] { shares[i], shares[j], shares[k] })) == Hex(master0);
bool twoWork = Hex(Combine(new[] { shares[0], shares[1] })) == Hex(master0);
Console.WriteLine($"any 3 of 5 shares rebuild the master key: {Lower(allEqual)}; 2 shares do: {Lower(twoWork)}");

var vault = new Vault(new() { ["web"] = new[] { "db/web" }, ["billing"] = new[] { "db/billing" } });
vault.Master = Combine(new[] { shares[0], shares[2], shares[4] }); // unseal
vault.Put("db/web", "p4ss-web"); vault.Put("db/billing", "p4ss-billing"); vault.Put("api/stripe", "sk_live_1");
string AllCt() => Hex(vault.Store.Values.SelectMany(e => e.Ct).ToArray());
var before = AllCt();
var reads = new[] { ("web", "db/web"), ("web", "db/billing"), ("billing", "db/billing"), ("web", "api/stripe") }.Select(x => vault.Read(x.Item1, x.Item2)).ToArray();
Console.WriteLine("reads: " + string.Join(" | ", reads.Select(r => r ?? "denied")));
vault.RotateMaster();
bool keysChanged = Hex(vault.Master!) != Hex(master0);
bool afterOk = vault.Read("web", "db/web") == "p4ss-web" && before == AllCt();
Console.WriteLine($"master rotated: {Lower(keysChanged)}; 3 data keys rewrapped, stored ciphertext unchanged and readable: {Lower(afterOk)}");
Console.WriteLine($"audit has {vault.Audit.Count} lines, last: {vault.Audit[^1]}");

var a = vault.Issue(0, 60, 120); vault.Issue(10, 60, 120);
vault.Renew(a, 50, 60); // a would reach 110
var gone75 = vault.Sweep(75);
vault.Renew(a, 100, 60); // capped at start + maxTtl = 120
var gone130 = vault.Sweep(130);
Console.WriteLine($"leases: revoked {string.Join(",", gone75)} at t=75, {string.Join(",", gone130)} at t=130 (expiry capped at {a.Expires})");

if (!allEqual || twoWork || !afterOk || !keysChanged || vault.Audit.Count != 5 || reads[1] != null || reads[3] != null || a.Expires != 120
    || string.Join(",", gone75) != "u-2" || string.Join(",", gone130) != "u-1" || vault.Leases.Count != 0) return 1;
return 0;

class Share { public long X; public List<long> Ys = new(); }
class Entry { public long[] Wrapped = null!, Ct = null!; public long NonceW, NonceC; }
class Lease { public string User = ""; public long Start, Expires, MaxTtl; }
class Vault
{
    public long[]? Master; public Dictionary<string, Entry> Store = new(); public List<string> Audit = new(); public List<Lease> Leases = new();
    Dictionary<string, string[]> policies; int issued;
    public Vault(Dictionary<string, string[]> p) { policies = p; }
    public void Put(string path, string text) // envelope: a fresh data key encrypts the secret, the master key only wraps it
    {
        var dek = RandomBytes(16); long nw = Next(), nc = Next();
        Store[path] = new Entry { Wrapped = Cipher(dek, Master!, nw), NonceW = nw, Ct = Cipher(ToBytes(text), dek, nc), NonceC = nc };
    }
    public string? Read(string token, string path) // every read is logged, allowed or not
    {
        bool allowed = Master != null && (policies.GetValueOrDefault(token) ?? new string[0]).Any(p => path.StartsWith(p));
        Audit.Add($"{token} {path} {(allowed ? "ok" : "denied")}");
        if (!allowed) return null;
        var e = Store[path];
        return ToText(Cipher(e.Ct, Cipher(e.Wrapped, Master!, e.NonceW), e.NonceC));
    }
    public void RotateMaster() // rewrap each data key under a new master; the stored secrets are not touched
    {
        var fresh = RandomBytes(16);
        foreach (var e in Store.Values) { var dek = Cipher(e.Wrapped, Master!, e.NonceW); e.NonceW = Next(); e.Wrapped = Cipher(dek, fresh, e.NonceW); }
        Master = fresh;
    }
    public Lease Issue(long now, long ttl, long max) { var l = new Lease { User = $"u-{++issued}", Start = now, Expires = now + ttl, MaxTtl = max }; Leases.Add(l); return l; }
    public void Renew(Lease l, long now, long ttl) => l.Expires = Math.Min(now + ttl, l.Start + l.MaxTtl);
    public List<string> Sweep(long now) { var dead = Leases.Where(l => l.Expires <= now).Select(l => l.User).ToList(); Leases = Leases.Where(l => l.Expires > now).ToList(); return dead; }
}
static class Crypto
{
public const long P = 257; // a prime just above 255, so each byte of the key is one number in the field
    static long state = 7; // seeded generator, so every run prints the same thing
public static long Next() { state = (state * 1664525 + 1013904223) % 4294967296; return state; }
public static long Rnd(long n) => Next() / 65536 % n;
public static long[] RandomBytes(int n) => Enumerable.Range(0, n).Select(_ => Rnd(256)).ToArray();
public static string Hex(long[] b) => string.Concat(b.Select(x => x.ToString("x2")));
public static long[] ToBytes(string t) => t.Select(c => (long)c).ToArray();
public static string ToText(long[] b) => new string(b.Select(x => (char)x).ToArray());
public static long Inv(long a) { long r = 1, b = a % P, e = P - 2; while (e > 0) { if ((e & 1) == 1) r = r * b % P; b = b * b % P; e >>= 1; } return r; }
public static string Lower(bool f) => f ? "true" : "false";

// Shamir: every byte is the constant term of a random polynomial of degree k-1; share x is its value at x.
public static Share[] Split(long[] secret, int n, int k)
{
    var shares = Enumerable.Range(0, n).Select(i => new Share { X = i + 1 }).ToArray();
    foreach (var b in secret)
    {
        var coef = new List<long> { b };
        for (int i = 0; i < k - 1; i++) coef.Add(Rnd(P));
        foreach (var s in shares) { long acc = 0; for (int i = coef.Count - 1; i >= 0; i--) acc = (acc * s.X + coef[i]) % P; s.Ys.Add(acc); }
    }
    return shares;
}
public static long[] Combine(Share[] shares) // Lagrange interpolation at x = 0
{
    var outp = new long[shares[0].Ys.Count];
    for (int t = 0; t < outp.Length; t++)
    {
        long sum = 0;
        foreach (var a in shares)
        {
            long num = 1, den = 1;
            foreach (var b in shares) if (b != a) { num = num * b.X % P; den = den * (b.X - a.X + P) % P; }
            sum = (sum + a.Ys[t] * num * Inv(den)) % P;
        }
        outp[t] = sum % 256; // values above 255 only appear for wrong shares
    }
    return outp;
}
public static long[] Cipher(long[] data, long[] key, long nonce) // XOR with the key and a stream from the nonce: same call encrypts and decrypts
{
    long s = nonce;
    return data.Select((d, i) => { s = (s * 1664525 + 1013904223) % 4294967296; return d ^ key[i % key.Length] ^ ((s >> 16) & 255); }).ToArray();
}

}
