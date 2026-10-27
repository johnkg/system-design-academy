// A miniature of the technique behind Dropbox's Magic Pocket, in C# (a teaching model, not Dropbox's code):
// blocks named by a hash go into append-only volumes, a full volume is closed, a closed volume is re-encoded from
// three copies to three data shards plus one XOR parity shard, a read rebuilds a lost shard from the others,
// and repair commits its new layout by raising a generation number.
// Everything is deterministic, so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public class Entry { public int Vol, Slot, Len; public bool Deleted; }
public class Volume
{
    public int Id; public bool Open = true; public string Mode = "replicated"; public int Generation;
    public List<byte[]> Slots = new(); public int[] Nodes = Array.Empty<int>(); public List<byte[]> Shards = new();
}

public static class Program
{
    const int SlotBytes = 16; // bytes in one block slot (real blocks are up to 4 MB)
    const int K = 3; // data slots per volume; a volume closes when they are full
    const int NodeCount = 6; // storage nodes in the toy cell
    const int Copies = 3; // replicas of a volume while it is young

    static readonly Dictionary<string, Entry> Blocks = new(); // block name -> entry
    static readonly List<Volume> Volumes = new();

    // Stand-in for the SHA-256 name of a block: 32-bit FNV-1a, printed as 8 hex digits.
    static string NameOf(string text)
    {
        uint h = 0x811c9dc5;
        foreach (var b in Encoding.UTF8.GetBytes(text)) h = unchecked((h ^ b) * 0x01000193u);
        return h.ToString("x8");
    }

    static byte[] Xor(byte[] a, byte[] b) => a.Zip(b, (x, y) => (byte)(x ^ y)).ToArray();
    static byte[] XorAll(IEnumerable<byte[]> items) => items.Aggregate(Xor);
    static string TextOf(byte[] data, int len) => Encoding.UTF8.GetString(data, 0, len);

    static void Put(string content)
    {
        var name = NameOf(content);
        if (Blocks.TryGetValue(name, out var known) && !known.Deleted) { Console.WriteLine($"put {content,-12} {name} already stored, nothing written"); return; }
        var vol = Volumes.Count > 0 ? Volumes[^1] : null;
        if (vol == null || !vol.Open)
        {
            vol = new Volume { Id = Volumes.Count, Nodes = Enumerable.Range(0, 3).Select(i => (Volumes.Count + i) % NodeCount).ToArray() };
            Volumes.Add(vol);
        }
        var data = Encoding.UTF8.GetBytes(content);
        var padded = new byte[SlotBytes]; data.CopyTo(padded, 0);
        vol.Slots.Add(padded); // append only: slots are never rewritten
        Blocks[name] = new Entry { Vol = vol.Id, Slot = vol.Slots.Count - 1, Len = data.Length };
        var line = $"put {content,-12} {name} volume {vol.Id} slot {vol.Slots.Count - 1}";
        if (vol.Slots.Count == K) { vol.Open = false; line += ", volume full and closed"; }
        Console.WriteLine(line);
    }

    // Cool a closed volume: three full copies become K data shards and one parity shard on different nodes.
    static void Encode(Volume vol)
    {
        var before = Copies * K * SlotBytes;
        vol.Shards = vol.Slots.Append(XorAll(vol.Slots)).ToList();
        vol.Nodes = Enumerable.Range(0, 4).Select(i => (vol.Id + i) % NodeCount).ToArray();
        vol.Mode = "encoded";
        vol.Generation++;
        Console.WriteLine($"volume {vol.Id} encoded: {before} bytes as {Copies} copies, {vol.Shards.Count * SlotBytes} bytes as {K}+1 shards on nodes {string.Join(",", vol.Nodes)}, generation {vol.Generation}");
    }

    static (string Data, string How) Read(string name, int down)
    {
        var e = Blocks[name];
        var vol = Volumes[e.Vol];
        if (vol.Mode == "replicated")
        {
            var node = vol.Nodes.First(n => n != down);
            return (TextOf(vol.Slots[e.Slot], e.Len), $"replica on node {node}");
        }
        if (vol.Nodes[e.Slot] != down) return (TextOf(vol.Shards[e.Slot], e.Len), $"shard {e.Slot} on node {vol.Nodes[e.Slot]}");
        var others = vol.Shards.Where((_, i) => i != e.Slot && vol.Nodes[i] != down).ToList();
        return (TextOf(XorAll(others), e.Len), $"shard {e.Slot} lost, rebuilt from {others.Count} other shards");
    }

    // The coordinator's repair: only a closed volume is moved, and the move commits by raising the generation.
    static void Repair(Volume vol, int down)
    {
        var lost = Array.IndexOf(vol.Nodes, down);
        var spare = Enumerable.Range(0, NodeCount).First(n => !vol.Nodes.Contains(n));
        vol.Shards[lost] = XorAll(vol.Shards.Where((_, i) => i != lost));
        vol.Nodes[lost] = spare;
        vol.Generation++;
        Console.WriteLine($"repair volume {vol.Id}: shard {lost} rebuilt on node {spare}, generation now {vol.Generation}");
    }

    public static int Main()
    {
        foreach (var c in new[] { "report-v1", "photo-001", "report-v1", "notes-draft", "invoice-0316", "tax-1997" }) Put(c);
        Console.WriteLine($"open volumes: {string.Join(",", Volumes.Where(v => v.Open).Select(v => v.Id))}");

        Encode(Volumes[0]);
        var photo = NameOf("photo-001");
        var r = Read(photo, -1);
        Console.WriteLine($"read photo-001: \"{r.Data}\" via {r.How}");

        var down = Volumes[0].Nodes[Blocks[photo].Slot];
        Console.WriteLine($"node {down} stops answering");
        r = Read(photo, down);
        Console.WriteLine($"read photo-001: \"{r.Data}\" via {r.How}");
        Repair(Volumes[0], down);
        Console.WriteLine($"node {down} comes back with generation {Volumes[0].Generation - 1} of volume 0; the table says {Volumes[0].Generation}, so its shard is ignored");

        Blocks[NameOf("notes-draft")].Deleted = true;
        Console.WriteLine("deleted notes-draft: volume 0 is unchanged, 2 of 3 slots are live, compaction will reclaim the rest");

        var ok = r.Data == "photo-001" && Volumes[0].Generation == 2;
        Console.WriteLine($"blocks {Blocks.Count}, volumes {Volumes.Count}, checks {(ok ? "passed" : "FAILED")}");
        return ok ? 0 : 1;
    }
}
