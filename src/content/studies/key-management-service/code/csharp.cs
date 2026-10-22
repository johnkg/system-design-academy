// Envelope encryption with a key management service, in C#.
// WARNING: the cipher below (FNV-1a hashing and an LCG keystream XOR) is a TOY to show the structure. It is NOT real cryptography.
// Shape: root key (the "HSM") wraps key versions, a key version wraps data keys, a data key encrypts the data.
using System;
using System.Collections.Generic;
using System.Linq;

public record Blob(int V, uint Nonce, int[] Ct, uint Mac);
public record Rec(Blob Blob, uint Nonce, int[] Ct);
public class Key { public Dictionary<string, string[]> Policy = new(); public List<uint> Wrapped = new(); public string State = "enabled"; public int DeleteAt; }

public static class Toy
{
    const uint Seed = 7;
    public const int DeletionWaitDays = 7; // a key scheduled for deletion can still be cancelled for a week
    static uint seed = Seed;
    public static uint Rng() => seed = unchecked(seed * 1664525u + 1013904223u);
    public static int[] Bytes(string s) => s.Select(c => (int)c).ToArray();
    public static string Text(int[] b) => new string(b.Select(c => (char)c).ToArray());
    public static uint Fnv(uint key, IEnumerable<int> data) { uint h = 2166136261u ^ key; foreach (int b in data) h = unchecked((h ^ (uint)b) * 16777619u); return h; }
    public static int[] Xor(uint key, uint nonce, int[] data)
    {
        uint s = key ^ nonce;
        return data.Select(b => { s = unchecked(s * 1664525u + 1013904223u); return b ^ (int)(s >> 24); }).ToArray();
    }
    public static int[] Word(uint n) => new[] { (int)(n >> 24), (int)((n >> 16) & 255), (int)((n >> 8) & 255), (int)(n & 255) };
    public static uint Unword(int[] b) => ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | (uint)b[3];
}

public class Kms
{
    readonly uint rootMask;
    public readonly Dictionary<string, Key> Keys = new();
    public int Day; public List<string> Audit = new(); public uint Chain;
    public Kms(uint rootKey) { rootMask = Toy.Fnv(rootKey, new[] { 1 }); }

    void Log(string who, string action, string keyId, string outcome) // append-only log; each entry is chained to the one before
    {
        string line = $"{Audit.Count + 1} day{Day} {who} {action} {keyId} {outcome}";
        Audit.Add(line); Chain = Toy.Fnv(Chain, Toy.Bytes(line));
    }
    public bool Verify() { uint c = 0; foreach (var l in Audit) c = Toy.Fnv(c, Toy.Bytes(l)); return c == Chain; }

    T Run<T>(string who, string action, string keyId, Func<Key, T> fn) // policy check, the operation, and an audit entry for every outcome
    {
        if (!Keys.TryGetValue(keyId, out var k) || !(k.Policy.GetValueOrDefault(action) ?? Array.Empty<string>()).Contains(who)) { Log(who, action, keyId, "DENIED"); throw new InvalidOperationException("denied"); }
        try { var r = fn(k); Log(who, action, keyId, "OK"); return r; }
        catch (InvalidOperationException e) { Log(who, action, keyId, "FAILED " + e.Message); throw; }
    }
    void AddVersion(Key k) => k.Wrapped.Add(Toy.Rng() ^ rootMask); // key material is stored only wrapped by the root key
    uint Kek(Key k, int v) => v > k.Wrapped.Count ? throw new InvalidOperationException("unknown version") : k.Wrapped[v - 1] ^ rootMask;
    void Usable(Key k) { if (k.State != "enabled") throw new InvalidOperationException(k.State == "pending" ? "pending deletion" : "destroyed"); }

    public void Create(string who, string keyId, Dictionary<string, string[]> policy)
    {
        var k = new Key { Policy = policy }; Keys[keyId] = k; AddVersion(k); Log(who, "create", keyId, "OK");
    }
    Blob Seal(Key k, uint dk)
    {
        int v = k.Wrapped.Count; uint nonce = Toy.Rng(), kek = Kek(k, v); var ct = Toy.Xor(kek, nonce, Toy.Word(dk));
        return new Blob(v, nonce, ct, Toy.Fnv(kek ^ nonce, ct));
    }
    uint Open(Key k, Blob b)
    {
        uint kek = Kek(k, b.V);
        if (Toy.Fnv(kek ^ b.Nonce, b.Ct) != b.Mac) throw new InvalidOperationException("bad mac");
        return Toy.Unword(Toy.Xor(kek, b.Nonce, b.Ct));
    }
    T Guarded<T>(string who, string action, string keyId, Func<Key, T> fn) => Run(who, action, keyId, k => { Usable(k); return fn(k); });
    public (uint Dk, Blob Blob) GenerateDataKey(string who, string keyId) => Guarded(who, "encrypt", keyId, k => { uint dk = Toy.Rng(); return (dk, Seal(k, dk)); });
    public uint Decrypt(string who, string keyId, Blob blob) => Guarded(who, "decrypt", keyId, k => Open(k, blob));
    public Blob Rewrap(string who, string keyId, Blob blob) => Guarded(who, "rewrap", keyId, k => Seal(k, Open(k, blob))); // the data key never leaves the service
    public void Rotate(string who, string keyId) => Run(who, "admin", keyId, k => { AddVersion(k); return 0; });
    public void SetState(string who, string keyId, string state, int days = 0) => Run(who, "admin", keyId, k => { k.State = state; k.DeleteAt = Day + days; return 0; });
    public void Advance(int days)
    {
        Day += days;
        foreach (var (id, k) in Keys) if (k.State == "pending" && Day >= k.DeleteAt) { k.State = "destroyed"; k.Wrapped.Clear(); Log("system", "destroy", id, "OK"); }
    }
}

public static class Program
{
    static Rec Put(Kms kms, string who, string keyId, string plain) { var g = kms.GenerateDataKey(who, keyId); uint nonce = Toy.Rng(); return new Rec(g.Blob, nonce, Toy.Xor(g.Dk, nonce, Toy.Bytes(plain))); }
    static string Get(Kms kms, string who, string keyId, Rec r) => Toy.Text(Toy.Xor(kms.Decrypt(who, keyId, r.Blob), r.Nonce, r.Ct));
    static string Attempt(Func<object> fn) { try { return "ok " + fn(); } catch (InvalidOperationException e) { return "error " + e.Message; } }
    static string Versions(IEnumerable<Rec> docs) => string.Join(",", docs.Select(d => d.Blob.V));
    static string Low(bool b) => b.ToString().ToLowerInvariant();

    public static int Main()
    {
        var kms = new Kms(0x5eed1234u);
        kms.Create("secops", "orders", new() { ["encrypt"] = new[] { "app", "batch" }, ["decrypt"] = new[] { "app" }, ["rewrap"] = new[] { "batch" }, ["admin"] = new[] { "secops" } });
        var docs = new[] { "card:4111-0001", "card:4111-0002", "card:4111-0003" }.Select(t => Put(kms, "app", "orders", t)).ToList();
        Console.WriteLine($"3 objects encrypted, blob versions: {Versions(docs)}, first ciphertext {string.Concat(docs[0].Ct.Select(b => b.ToString("x2")))}");
        kms.Rotate("secops", "orders");
        docs.Add(Put(kms, "app", "orders", "card:4111-0004"));
        Console.WriteLine($"after rotation, blob versions: {Versions(docs)}, old object still reads: {Get(kms, "app", "orders", docs[0])}");
        var moved = docs.Select(d => d with { Blob = kms.Rewrap("batch", "orders", d.Blob) }).ToList();
        bool same = moved.Zip(docs).All(p => p.First.Ct.SequenceEqual(p.Second.Ct));
        Console.WriteLine($"rewrapped, blob versions: {Versions(moved)}, data ciphertext untouched: {Low(same)}");
        Console.WriteLine($"batch decrypt: {Attempt(() => Get(kms, "batch", "orders", moved[0]))}; mallory encrypt: {Attempt(() => kms.GenerateDataKey("mallory", "orders"))}");
        kms.SetState("secops", "orders", "pending", Toy.DeletionWaitDays);
        Console.WriteLine($"during the wait: {Attempt(() => Get(kms, "app", "orders", moved[1]))}");
        kms.SetState("secops", "orders", "enabled");
        Console.WriteLine($"after cancel: {Attempt(() => Get(kms, "app", "orders", moved[1]))}");
        kms.Advance(3); kms.SetState("secops", "orders", "pending", Toy.DeletionWaitDays); kms.Advance(Toy.DeletionWaitDays - 1);
        Console.WriteLine($"day {kms.Day}, still waiting: {Attempt(() => Get(kms, "app", "orders", moved[2]))}");
        kms.Advance(1);
        Console.WriteLine($"day {kms.Day}, deleted: {Attempt(() => Get(kms, "app", "orders", moved[2]))}");
        int Count(string w) => kms.Audit.Count(l => l.Contains(w));
        Console.WriteLine($"audit: {kms.Audit.Count} entries, {Count(" OK")} ok, {Count("DENIED")} denied, {Count("FAILED")} failed, chain {kms.Chain:x8}, intact {Low(kms.Verify())}");
        var forged = kms.Audit.ToList(); kms.Audit[3] = kms.Audit[3].Replace("OK", "DENIED");
        Console.WriteLine($"after editing one entry, chain intact: {Low(kms.Verify())}");
        kms.Audit = forged;
        return Versions(docs) != "1,1,1,2" || Count("DENIED") != 2 || !kms.Verify() ? 1 : 0;
    }
}
