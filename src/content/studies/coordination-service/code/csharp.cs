// A tiny coordination service in C#: a replicated log with majority commit, a versioned key tree,
// compare-and-set, one-shot watches, sessions with ephemeral keys, and a lock built from sequential keys.
using System;
using System.Collections.Generic;
using System.Linq;

var c = new Cluster(5);
c.Create("/app", ""); c.Create("/app/config", "v1");
c.Set("/app/config", "v2", 0);
bool stale = Refused(() => c.Set("/app/config", "v3", 0)) == "bad version";
var cfg = c.Get("/app/config")!;
Console.WriteLine($"config {cfg.Data}, version {cfg.Ver}, stale writer rejected: {Low(stale)}");

c.Reps[4].Slow = true; c.Set("/app/config", "v4", 1);
Console.WriteLine($"follower 4 says {c.Get("/app/config", 4)!.Data}; after a synced read it says {c.Get("/app/config", 4, true)!.Data}");
c.Reps[4].Slow = false;

c.Reps[3].Up = c.Reps[4].Up = false; c.Set("/app/config", "v5", 2);
c.Reps[2].Up = false;
bool blocked = Refused(() => c.Set("/app/config", "v6", 3)) == "no quorum";
Console.WriteLine($"with 3 of 5 up the write works; with 2 of 5 up it is refused: {Low(blocked)}");
foreach (var r in c.Reps) r.Up = true;
c.Reps[0].Up = false; c.Elect();
Console.WriteLine($"leader 0 crashed, leader {c.Leader} has config {c.Get("/app/config")!.Data}");

c.Create("/lock", "");
var holders = new List<(string Path, int Zxid)>();
foreach (var s in new[] { "a", "b", "c" }) { c.Sessions[s] = 0; holders.Add(c.Create("/lock/n-", s, s, true)); }
string First() => c.State[c.State.Keys.Where(p => p.StartsWith("/lock/")).Min()!].Owner;
Console.WriteLine($"lock holder {First()}, fencing token {holders[0].Zxid}");
c.Watches[holders[0].Path] = new List<string> { "b" };
c.Sessions["b"] = c.Sessions["c"] = 9;
c.Expire(10, 5);
Console.WriteLine($"session a expired, {string.Join("; ", c.Events)}; lock holder now {First()}, token {holders[1].Zxid}");
if (!stale || !blocked || First() != "b" || holders[1].Zxid <= holders[0].Zxid) Environment.Exit(1);

static string Low(bool b) => b ? "true" : "false";
static string? Refused(Action fn) { try { fn(); return null; } catch (InvalidOperationException e) { return e.Message; } }

record Node(string Data, int Ver, string Owner);
record Op(string T, string Path, string Data = "", string Owner = "");

class Replica {
    public Dictionary<string, Node> Nodes = new(); public int Applied; public bool Up = true, Slow;
    public void Apply(Op op) {
        Nodes.TryGetValue(op.Path, out var n);
        if (op.T == "create") Nodes[op.Path] = new Node(op.Data, 0, op.Owner);
        else if (op.T == "set") Nodes[op.Path] = n! with { Data = op.Data, Ver = n.Ver + 1 };
        else Nodes.Remove(op.Path);
        Applied++;
    }
}

class Cluster {
    public List<Replica> Reps; public int Quorum, Leader; public List<Op> Log = new();
    public Dictionary<string, int> Seq = new(); public Dictionary<string, int> Sessions = new();
    public Dictionary<string, List<string>> Watches = new(); public List<string> Events = new();
    public Cluster(int size) { Reps = Enumerable.Range(0, size).Select(_ => new Replica()).ToList(); Quorum = size / 2 + 1; }
    public Dictionary<string, Node> State => Reps[Leader].Nodes;
    public void Sync(Replica r) { while (r.Applied < Log.Count) r.Apply(Log[r.Applied]); }
    public int Commit(Op op) { // a write needs a majority of replicas that are up and keeping pace
        var keeping = Reps.Where(r => r.Up && !r.Slow).ToList();
        if (keeping.Count < Quorum) throw new InvalidOperationException("no quorum");
        Log.Add(op);
        foreach (var r in keeping) Sync(r);
        if (Watches.Remove(op.Path, out var names)) // watches fire once
            foreach (var w in names) Events.Add($"{w} saw {op.T} {op.Path}");
        return Log.Count; // the position in the log doubles as a transaction id
    }
    public (string Path, int Zxid) Create(string path, string data, string owner = "", bool sequential = false) {
        if (sequential) { Seq[path] = Seq.GetValueOrDefault(path) + 1; path += Seq[path].ToString().PadLeft(3, '0'); }
        return (path, Commit(new Op("create", path, data, owner)));
    }
    public void Set(string path, string data, int expected) { // compare-and-set on the version
        if (State[path].Ver != expected) throw new InvalidOperationException("bad version");
        Commit(new Op("set", path, data));
    }
    public Node? Get(string path, int? replica = null, bool sync = false) {
        var r = Reps[replica ?? Leader];
        if (sync) Sync(r); // a linearizable read first catches up with the leader
        return r.Nodes.GetValueOrDefault(path);
    }
    public void Elect() { // of the live replicas, the one with the longest log holds every committed entry
        var live = Enumerable.Range(0, Reps.Count).Where(i => Reps[i].Up).ToList();
        if (live.Count < Quorum) throw new InvalidOperationException("no quorum");
        Leader = live.Aggregate((a, b) => Reps[b].Applied > Reps[a].Applied ? b : a);
    }
    public void Expire(int now, int timeout) { // a silent session loses its ephemeral keys
        foreach (var (id, last) in Sessions.ToList()) {
            if (now - last <= timeout) continue;
            Sessions.Remove(id);
            foreach (var (p, n) in State.ToList()) if (n.Owner == id) Commit(new Op("delete", p));
        }
    }
}
