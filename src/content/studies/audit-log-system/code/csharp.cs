// A tamper-evident audit log in C#: every entry is chained to the one before it,
// and signed checkpoints hold a Merkle root over each block, so even a clean rewrite is caught.
// FNV-1a stands in for a cryptographic hash here; a real log uses SHA-256 and signs the checkpoints.
using System;
using System.Collections.Generic;
using System.Linq;

const int Block = 250;
const string Genesis = "00000000";
const int Docs = 50; // documents the demo actions target
const int StartTime = 1700000000; // Unix seconds of the first entry
const int EntryGapS = 3; // entries are about 3 s apart, with up to 2 s of jitter
const int Entries = 1000;
const int EditAt = 300; // the entry an attacker edits
const int TruncateTo = 900;
const int ProveSeq = 777; // the entry the inclusion proof is for
string[] actors = { "alice", "bob", "carol", "dan" };
string[] actions = { "login", "read", "update", "delete", "export" };

uint seed = 7;
int Random(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 8) % (uint)n); }

string Fnv(string text)
{
    uint h = 2166136261;
    foreach (char c in text) h = unchecked((h ^ c) * 16777619u);
    return h.ToString("x8");
}

string DataOf(Entry e) => $"{e.Seq}|{e.Actor}|{e.Action}|{e.Target}|{e.Time}";
string Link(string prev, Entry e) => Fnv($"{prev}|{DataOf(e)}");

List<Entry> Build(int count) // append-only: each entry stores the hash of the entry before it
{
    var log = new List<Entry>();
    string prev = Genesis;
    for (int seq = 0; seq < count; seq++)
    {
        var e = new Entry { Seq = seq, Actor = actors[Random(actors.Length)], Action = actions[Random(actions.Length)], Target = $"doc-{Random(Docs)}" };
        e.Time = StartTime + seq * EntryGapS + Random(EntryGapS);
        e.Hash = Link(prev, e);
        prev = e.Hash;
        log.Add(e);
    }
    return log;
}

string Merkle(List<string> level, int index = 0, List<(char, string)>? proof = null) // an odd node is paired with itself
{
    while (level.Count > 1)
    {
        var next = new List<string>();
        for (int i = 0; i < level.Count; i += 2)
        {
            string right = i + 1 < level.Count ? level[i + 1] : level[i];
            next.Add(Fnv(level[i] + right));
            if (proof != null && (index == i || index == i + 1)) proof.Add(index == i ? ('R', right) : ('L', level[i]));
        }
        if (proof != null) index >>= 1;
        level = next;
    }
    return level[0];
}

List<string> Hashes(List<Entry> log, int start, int end) => log.Skip(start).Take(end - start).Select(e => e.Hash).ToList();

List<Checkpoint> Checkpoints(List<Entry> log) // kept outside the log, signed in real life
{
    var list = new List<Checkpoint>();
    for (int end = Block; end <= log.Count; end += Block) list.Add(new Checkpoint(end, log[end - 1].Hash, Merkle(Hashes(log, end - Block, end))));
    return list;
}

int VerifyChain(List<Entry> log) // index of the first entry whose hash does not match, or -1
{
    string prev = Genesis;
    foreach (var e in log) { if (e.Hash != Link(prev, e)) return e.Seq; prev = e.Hash; }
    return -1;
}

int VerifyCheckpoints(List<Entry> log, List<Checkpoint> cps) // end of the first checkpoint that disagrees, or -1
{
    foreach (var c in cps)
    {
        if (log.Count < c.End || log[c.End - 1].Hash != c.Head) return c.End;
        if (Merkle(Hashes(log, c.End - Block, c.End)) != c.Root) return c.End;
    }
    return -1;
}

bool CheckProof(string hash, List<(char, string)> proof, string root)
{
    foreach (var (side, sibling) in proof) hash = side == 'R' ? Fnv(hash + sibling) : Fnv(sibling + hash);
    return hash == root;
}

var log = Build(Entries);
var cps = Checkpoints(log);
Console.WriteLine($"entries: {log.Count}, checkpoints at: {string.Join(", ", cps.Select(c => c.End))}");
Console.WriteLine($"head {log[999].Hash}, last root {cps[3].Root}");
Console.WriteLine($"intact: chain {VerifyChain(log)}, checkpoints {VerifyCheckpoints(log, cps)}");

var edited = log.Select(e => e.Copy()).ToList();
edited[EditAt].Actor = "mallory";
int editChain = VerifyChain(edited);
Console.WriteLine($"edit entry 300: chain breaks at {editChain}");

string p = edited[EditAt - 1].Hash; // a clean rewrite: recompute every later hash
for (int i = EditAt; i < edited.Count; i++) { edited[i].Hash = Link(p, edited[i]); p = edited[i].Hash; }
int rewriteChain = VerifyChain(edited);
int rewriteCp = VerifyCheckpoints(edited, cps);
Console.WriteLine($"rewrite from 300: chain {rewriteChain}, checkpoints disagree at {rewriteCp}");

var dropped = log.Take(TruncateTo).ToList();
int dropCp = VerifyCheckpoints(dropped, cps);
Console.WriteLine($"truncate to 900: chain {VerifyChain(dropped)}, checkpoints disagree at {dropCp}");

var proof = new List<(char, string)>();
int proveStart = ProveSeq - ProveSeq % Block;
Merkle(Hashes(log, proveStart, proveStart + Block), ProveSeq - proveStart, proof);
bool okProof = CheckProof(log[ProveSeq].Hash, proof, cps[3].Root);
bool badProof = CheckProof(Fnv("forged"), proof, cps[3].Root);
Console.WriteLine($"proof for entry 777: {proof.Count} hashes, genuine {okProof.ToString().ToLower()}, forged {badProof.ToString().ToLower()}");

if (editChain != EditAt || rewriteChain != -1 || rewriteCp != 500 || dropCp != Entries || !okProof || badProof) Environment.Exit(1);

record Checkpoint(int End, string Head, string Root);

class Entry
{
    public int Seq, Time;
    public string Actor = "", Action = "", Target = "", Hash = "";
    public Entry Copy() => (Entry)MemberwiseClone();
}
