// A content-addressed container registry, in C#:
// blobs are named by the hash of their bytes (so identical layers are stored once), uploads can resume at an offset,
// tags point at manifests, and garbage collection sweeps unreferenced blobs but spares ones that are still being pushed.
using System;
using System.Collections.Generic;
using System.Linq;

public class Blob { public string Data = ""; public int Born; }
public class Registry
{
    public readonly Dictionary<string, Blob> Blobs = new();
    public readonly Dictionary<string, string> Tags = new();
    readonly Dictionary<int, string> uploads = new();
    int clock, nextId = 1;
    public int Deduped;

    public static string Digest(string s)  // a stand-in for sha256, so all three languages print the same
    {
        uint h = 0x811c9dc5;
        foreach (char c in s) h = unchecked((h ^ c) * 0x01000193u);
        return "fnv1a:" + h.ToString("x8");
    }

    public bool Head(string d) // "do you have it?" also refreshes its age
    {
        if (!Blobs.TryGetValue(d, out var b)) return false;
        b.Born = ++clock; Deduped++; return true;
    }
    public int StartUpload() { int id = nextId++; uploads[id] = ""; return id; }
    public int Offset(int id) => uploads[id].Length;
    public int Patch(int id, int offset, string chunk) // a chunk is accepted only at the offset the server expects, so a retry cannot corrupt the upload
    {
        if (offset != Offset(id)) return -1;
        uploads[id] += chunk; return Offset(id);
    }
    public bool Finish(int id, string want) // the server recomputes the digest; it never trusts the client's claim
    {
        string data = uploads[id]; uploads.Remove(id);
        if (Digest(data) == want) Blobs[want] = new Blob { Data = data, Born = ++clock };
        return Digest(data) == want;
    }
    public bool Put(string data) { int id = StartUpload(); Patch(id, 0, data); return Finish(id, Digest(data)); }

    public string PutManifest(string reference, List<string> layers) // a manifest may only name blobs that already exist
    {
        string? missing = layers.FirstOrDefault(d => !Blobs.ContainsKey(d));
        if (missing != null) return "rejected: unknown " + missing;
        string text = string.Join("\n", layers), d = Digest(text);
        Blobs[d] = new Blob { Data = text, Born = ++clock }; Tags[reference] = d;
        return d;
    }

    // mark everything reachable from a tag, then sweep blobs that are unmarked and older than the grace period
    public (int Swept, int Freed) Gc(int grace)
    {
        var marked = new HashSet<string>(Tags.Values);
        foreach (var m in Tags.Values) marked.UnionWith(Blobs[m].Data.Split('\n'));
        var dead = Blobs.Where(kv => !marked.Contains(kv.Key) && kv.Value.Born <= clock - grace).Select(kv => kv.Key).ToList();
        int freed = dead.Sum(d => Blobs[d].Data.Length);
        dead.ForEach(d => Blobs.Remove(d));
        return (dead.Count, freed);
    }
    public int Size() => Blobs.Values.Sum(b => b.Data.Length);
}

public static class Program
{
    const long Seed = 7;
    const int Images = 30, BaseLayers = 6, RuntimeLayers = 4, Retired = 10;
    const int BaseSize = 600, BaseSizeStep = 100, RuntimeSize = 300, AppMinSize = 100, AppSizeSpread = 100; // bytes
    const int BigSize = 650, Chunk = 200; // the resumable upload sends 200-byte chunks
    const int MinDeduped = 20; // shared layers must save at least this many uploads
    static long seed = Seed;
    static int Rnd(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }
    static string Layer(string name, int size) => name + ":" + new string('x', size - name.Length - 1);

    public static int Main()
    {
        var reg = new Registry();
        int logical = 0;
        string Push(string reference, string[] texts) // upload only what is missing, then publish the manifest
        {
            var ds = new List<string>();
            foreach (var t in texts) { logical += t.Length; var d = Registry.Digest(t); if (!reg.Head(d)) reg.Put(t); ds.Add(d); }
            return reg.PutManifest(reference, ds);
        }
        for (int i = 0; i < Images; i++) // 30 images share 6 base layers and 4 runtime layers, and each has its own app layer
        {
            int b = Rnd(BaseLayers), mid = Rnd(RuntimeLayers);
            Push($"app{i}:v1", new[] { Layer("base" + b, BaseSize + BaseSizeStep * b), Layer("rt" + mid, RuntimeSize), Layer("app" + i, AppMinSize + Rnd(AppSizeSpread)) });
        }
        Console.WriteLine($"30 images, logical {logical} bytes, stored {reg.Size()} bytes in {reg.Blobs.Count} blobs, {reg.Deduped} uploads skipped");

        string big = Layer("big", BigSize), want = Registry.Digest(big);
        int id = reg.StartUpload();
        reg.Patch(id, 0, big[..Chunk]); reg.Patch(id, Chunk, big[Chunk..(2 * Chunk)]);
        Console.WriteLine($"stale retry at offset 200: {reg.Patch(id, Chunk, big[Chunk..(2 * Chunk)])}; server says resume at {reg.Offset(id)}");
        reg.Patch(id, reg.Offset(id), big[(2 * Chunk)..]);
        Console.WriteLine($"resumed upload verified: {reg.Finish(id, want).ToString().ToLowerInvariant()}");

        for (int i = 0; i < Retired; i++) reg.Tags.Remove($"app{i}:v1"); // retire ten images
        var live = reg.Gc(0);
        Console.WriteLine($"gc after untagging 10 images: swept {live.Swept} blobs, freed {live.Freed} bytes, {reg.Blobs.Count} blobs left");
        if (reg.Tags.Values.SelectMany(m => reg.Blobs[m].Data.Split('\n')).Any(d => !reg.Blobs.ContainsKey(d))) { Console.WriteLine("BROKEN IMAGE"); return 1; }

        foreach (int grace in new[] { 0, 5 })
        {
            var r = new Registry();
            string t = Layer("late", 200), d = Registry.Digest(t);
            r.Put(t);   // the client has uploaded its layer but not yet its manifest
            r.Gc(grace); // a collection runs in between
            bool ok = !r.PutManifest("late:v1", new List<string> { d }).StartsWith("rejected");
            Console.WriteLine($"grace {grace}: manifest commit -> {(ok ? "ok" : "rejected, layer was swept")}");
        }
        return reg.Deduped < MinDeduped || reg.Size() >= logical || live.Swept == 0 ? 1 : 0;
    }
}
