// An offline-first sync engine in C#:
// each device keeps a local copy and an outbox, the server merges field by field (newest write wins), and a device that stayed away too long starts again from a snapshot.
using System;
using System.Collections.Generic;
using System.Linq;

string[] fieldNames = { "title", "done", "note" };
long seed = 99;
int Rnd(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

var server = new Server();
var log = new List<Write>();
var a = new Client("A", 0, server, log);
var b = new Client("B", -600000, server, log); // B's clock is 10 minutes slow
var c3 = new Client("C", 0, server, log);
int edits = 0, deletes = 0, removed = 0, ghosts = 0;
for (int step = 0; step < 600; step++)
{
    int d = Rnd(2), id = Rnd(12), kind = Rnd(100);
    long wall = 5000000 + step * 1000L;
    var c = d == 0 ? a : b;
    if (!(c.Db.ContainsKey(id) && Sync.Gone(c.Db[id]))) // a deleted row is not on screen, so it cannot be edited
    {
        if (kind < 4) { c.Write(id, "_gone", 1, wall); deletes++; }
        else { string f = fieldNames[Rnd(3)]; c.Write(id, f, Rnd(100), wall); edits++; }
    }
    if (step % 7 == d) c.SyncNow(Rnd(4) == 0);
    if (step == 100) c3.SyncNow(false); // C syncs once and then stays offline
    if (step == 400) removed = server.Compact(server.Seq - 100);
}
var before = c3.Db.Where(kv => !Sync.Gone(kv.Value)).Select(kv => kv.Key).ToList();
a.SyncNow(false); b.SyncNow(false);
bool wasReset = c3.SyncNow(false);
a.SyncNow(false); b.SyncNow(false);
foreach (var id in before) if (!c3.Db.ContainsKey(id) || Sync.Gone(c3.Db[id])) ghosts++;

var truth = new Dictionary<int, Dictionary<string, Cell>>(); // the same writes merged in one pass, to check against
foreach (var w in log)
{
    if (!truth.ContainsKey(w.Id)) truth[w.Id] = new();
    Sync.Merge(truth[w.Id], w);
}
var serverDb = server.Recs.ToDictionary(kv => kv.Key, kv => kv.Value.F);
var views = new[] { a.Db, b.Db, c3.Db, serverDb, truth }.Select(x => Sync.View(x, fieldNames)).ToArray();
bool agree = views.All(v => v == views[0]);
long h = 7;
foreach (char ch in views[0]) h = (h * 31 + ch) % 1000000007;
string T(bool x) => x ? "true" : "false";
Console.WriteLine($"{edits} edits and {deletes} deletes on 2 live devices; duplicate pushes ignored: {server.Dups}");
Console.WriteLine($"compaction at seq {server.Floor} removed {removed} tombstones; {server.Recs.Count} records remain");
Console.WriteLine($"device C was offline from step 100: reset {T(wasReset)}, deleted rows it still showed: {ghosts}");
Console.WriteLine($"all devices, server and the one-pass merge agree: {T(agree)}; checksum {h}");
if (!agree || !wasReset || server.Dups == 0) Environment.Exit(1);

record Cell(int V, long Ts, string Dev);
record Write(string Mid, int Id, string Field, int V, long Ts, string Dev);
class Rec { public Dictionary<string, Cell> F = new(); public int Seq; }

static class Sync
{
    // The newer write to a field wins; equal timestamps are settled by the device name.
    public static bool Newer(long ts, string dev, Cell cur) => ts > cur.Ts || (ts == cur.Ts && string.CompareOrdinal(dev, cur.Dev) > 0);
    public static void Merge(Dictionary<string, Cell> fields, Write w) => MergeCell(fields, w.Field, new Cell(w.V, w.Ts, w.Dev));
    public static void MergeCell(Dictionary<string, Cell> fields, string field, Cell c)
    {
        if (!fields.TryGetValue(field, out var cur) || Newer(c.Ts, c.Dev, cur)) fields[field] = c;
    }
    public static bool Gone(Dictionary<string, Cell> f) => f.TryGetValue("_gone", out var g) && g.V == 1; // a delete is just another field: a tombstone
    public static string View(Dictionary<int, Dictionary<string, Cell>> recs, string[] names) =>
        string.Join(" ", recs.Where(kv => !Gone(kv.Value)).OrderBy(kv => kv.Key)
            .Select(kv => $"{kv.Key}:" + string.Join("/", names.Select(k => kv.Value.TryGetValue(k, out var cell) ? cell.V.ToString() : "-"))));
}

class Server
{
    public Dictionary<int, Rec> Recs = new();
    public int Seq, Floor, Dups;
    HashSet<string> seen = new();
    public void Push(List<Write> muts)
    {
        foreach (var m in muts)
        {
            if (!seen.Add(m.Mid)) { Dups++; continue; } // a retried mutation is acknowledged but not applied again
            if (!Recs.ContainsKey(m.Id)) Recs[m.Id] = new Rec();
            Sync.Merge(Recs[m.Id].F, m);
            Recs[m.Id].Seq = ++Seq;
        }
    }
    public (bool Reset, List<(int Id, Dictionary<string, Cell> F)> Recs, int Cursor) Pull(int cursor)
    {
        bool reset = cursor < Floor; // the tombstones this device needs were already collected
        var list = Recs.Where(kv => reset || kv.Value.Seq > cursor).Select(kv => (kv.Key, kv.Value.F)).ToList();
        return (reset, list, Seq);
    }
    public int Compact(int horizon) // forget tombstones older than the horizon
    {
        var dead = Recs.Where(kv => Sync.Gone(kv.Value.F) && kv.Value.Seq <= horizon).Select(kv => kv.Key).ToList();
        foreach (var id in dead) Recs.Remove(id);
        Floor = horizon; return dead.Count;
    }
}

class Client
{
    public Dictionary<int, Dictionary<string, Cell>> Db = new();
    List<Write> outbox = new();
    string dev; long skew, last; int cursor, n; Server server; List<Write> log;
    public Client(string dev, long skew, Server server, List<Write> log) { this.dev = dev; this.skew = skew; this.server = server; this.log = log; }
    Dictionary<string, Cell> Fields(int id) { if (!Db.ContainsKey(id)) Db[id] = new(); return Db[id]; }
    public void Write(int id, string field, int v, long wall)
    {
        long ts = Math.Max(wall + skew, last + 1); last = ts; // never behind anything this device has seen
        var w = new Write($"{dev}-{++n}", id, field, v, ts, dev);
        Sync.Merge(Fields(id), w); outbox.Add(w); log.Add(w);
    }
    public bool SyncNow(bool retry)
    {
        server.Push(outbox);
        if (retry) server.Push(outbox); // the reply was lost, so the client sends the same batch again
        outbox = new();
        var res = server.Pull(cursor);
        if (res.Reset) Db = new();
        foreach (var (id, f) in res.Recs)
            foreach (var (field, cell) in f) { Sync.MergeCell(Fields(id), field, cell); last = Math.Max(last, cell.Ts); }
        cursor = res.Cursor; return res.Reset;
    }
}
