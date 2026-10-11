// Merkle tree anti-entropy: find and repair the key ranges where two replicas differ.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

const int NKeys = 4096, Leaves = 64, PerLeaf = NKeys / Leaves; // 64 keys per leaf range

static byte[] Sha(byte[] data) => SHA256.HashData(data);

static List<byte[]>[] BuildTree(Dictionary<int, string> store)
{
    // Leaf i hashes the sorted "key=value" lines of its key range; parents hash their two children.
    var level = new List<byte[]>();
    for (int i = 0; i < Leaves; i++)
    {
        var text = new StringBuilder();
        for (int k = i * PerLeaf; k < (i + 1) * PerLeaf; k++)
            if (store.TryGetValue(k, out var v)) text.Append($"{k}={v}\n");
        level.Add(Sha(Encoding.UTF8.GetBytes(text.ToString())));
    }
    var levels = new List<List<byte[]>> { level };
    while (level.Count > 1)
    {
        var next = new List<byte[]>();
        for (int i = 0; i < level.Count; i += 2) next.Add(Sha(level[i].Concat(level[i + 1]).ToArray()));
        levels.Insert(0, next);
        level = next;
    }
    return levels.ToArray(); // [0] = root, last = leaves
}

static void Diff(List<byte[]>[] a, List<byte[]>[] b, int depth, int idx, int[] comparisons, List<int> output)
{
    comparisons[0]++; // one hash exchanged and compared
    if (a[depth][idx].SequenceEqual(b[depth][idx])) return;
    if (depth == a.Length - 1) { output.Add(idx); return; }
    Diff(a, b, depth + 1, 2 * idx, comparisons, output);
    Diff(a, b, depth + 1, 2 * idx + 1, comparisons, output);
}

// Replica A is the source of truth; B has drifted.
var a = new Dictionary<int, string>();
for (int k = 0; k < NKeys; k++) a[k] = $"v{(k * 7) % 1000}";
var b = new Dictionary<int, string>(a);

long seed = 42; // MINSTD generator
int Rand(int n) { seed = (seed * 48271) % 2147483647; return (int)(seed % n); }
for (int i = 0; i < 4; i++) b[Rand(NKeys)] = "stale"; // missed writes
b.Remove(Rand(NKeys)); // lost write

var ta = BuildTree(a); var tb = BuildTree(b);
Console.WriteLine($"roots equal before: {(ta[0][0].SequenceEqual(tb[0][0])).ToString().ToLower()}");
var cmp = new int[1]; var ranges = new List<int>();
Diff(ta, tb, 0, 0, cmp, ranges);
Console.WriteLine($"differing ranges: {ranges.Count} -> [{string.Join(", ", ranges)}]");
Console.WriteLine($"hash comparisons: {cmp[0]} ({cmp[0] * 32} bytes), keys: {NKeys}, flat list: {Leaves} hashes");

int sent = 0;
foreach (var i in ranges)
    for (int k = i * PerLeaf; k < (i + 1) * PerLeaf; k++)
    {
        if (a.TryGetValue(k, out var v)) b[k] = v; else b.Remove(k);
        sent++;
    }
Console.WriteLine($"keys transferred: {sent} of {NKeys}");
var tb2 = BuildTree(b);
bool same = ta[0][0].SequenceEqual(tb2[0][0]);
Console.WriteLine($"roots equal after: {same.ToString().ToLower()}, root {Convert.ToHexString(ta[0][0]).ToLower()[..8]}");

if (!same) return 1;
if (cmp[0] * 20 >= NKeys) return 1;
if (sent > ranges.Count * PerLeaf) return 1;
return 0;
