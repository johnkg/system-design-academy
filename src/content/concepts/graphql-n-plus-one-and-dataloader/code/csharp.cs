// A miniature GraphQL-style executor over in-memory tables, with a DataLoader that collects keys until the end of a tick.
// The "tick" is simulated: the executor calls Dispatch() after every resolver of one tree level has run, so it is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

const int N = 5, M = 4, Users = 6; // 5 posts, 4 comments each, 6 users
var users = Enumerable.Range(1, Users).Select(i => new Row($"U{i}", i, 0, 0)).ToList();
var posts = Enumerable.Range(1, N).Select(i => new Row($"P{i}", i, 0, (i * 2) % Users + 1)).ToList();
var comments = Enumerable.Range(1, N * M).Select(i => new Row($"C{i}", i, (i - 1) / M + 1, (i * 5 + 3) % Users + 1)).ToList();

Sel S(string name, params Sel[] kids) => new Sel(name, kids.ToList());
var queries = new (string Text, List<Sel> Selection, int NaiveQ, int BatchQ)[]
{
    ("posts { comments { author } }", new() { S("posts", S("comments", S("author"))) }, 1 + N + N * M, 3),
    ("posts { author comments { author } }", new() { S("posts", S("author"), S("comments", S("author"))) }, 1 + N + N + N * M, 4),
};

void Check(bool ok, string msg) { if (!ok) { Console.WriteLine("FAILED: " + msg); Environment.Exit(1); } }

(Db Db, uint Sum) Run(List<Sel> selection, string mode)
{
    var (batch, cache) = mode switch { "naive" => (false, false), "batch" => (true, false), _ => (true, true) };
    var db = new Db(users, posts, comments);
    var ctx = new Ctx
    {
        Db = db,
        Users = new Loader(ids => db.UsersIn(ids).ToDictionary(r => r.Id, r => (object)r), batch, cache),
        Comments = new Loader(ids => { var rows = db.CommentsIn(ids); return ids.Distinct().ToDictionary(i => i, i => (object)rows.Where(c => c.PostId == i).ToList()); }, batch, cache),
    };
    var root = new Node(null);
    Exec.Execute(selection, new List<Node> { root }, ctx);
    var sum = Exec.Fnv(Exec.Ser(root));
    var hits = ctx.Users.Hits + ctx.Comments.Hits;
    Console.WriteLine($"  {mode,-5} queries={db.Queries,2} keys={db.Keys,2} rows={db.Rows,2} cache_hits={hits,2} checksum={sum}");
    return (db, sum);
}

foreach (var (text, selection, naiveQ, batchQ) in queries)
{
    Console.WriteLine(text);
    var (da, sa) = Run(selection, "naive"); var (db, sb) = Run(selection, "batch"); var (dc, sc) = Run(selection, "cache");
    Check(sa == sb && sb == sc, "all strategies must return identical results");
    Check(da.Queries == naiveQ, $"naive must make {naiveQ} queries");
    Check(db.Queries == batchQ && dc.Queries == batchQ, $"batched must make {batchQ} queries");
    Check(dc.Keys < db.Keys, "the cache must send fewer keys");
    if (text.StartsWith("posts { comments")) foreach (var sql in dc.Log) Console.WriteLine("    " + sql);
}
Console.WriteLine("identical results, exact query counts");

record Row(string Tag, int Id, int PostId, int AuthorId);
record Sel(string Name, List<Sel> Kids);

class Node(Row? row) { public Row? Row = row; public List<(string Name, List<Node> Kids, bool IsList)> Out = new(); }
class Future { public object? Value; }
class Ctx { public Db Db = null!; public Loader Users = null!, Comments = null!; }

class Db(List<Row> users, List<Row> posts, List<Row> comments) // counts every query it receives
{
    public int Queries, Keys, Rows; public List<string> Log = new();
    List<Row> Run(string sql, int keys, List<Row> rows) { Queries++; Keys += keys; Rows += rows.Count; Log.Add(sql); return rows; }
    public List<Row> AllPosts() => Run("SELECT * FROM posts", 0, posts);
    public List<Row> UsersIn(List<int> ids) => Run($"SELECT * FROM users WHERE id IN ({string.Join(",", ids.Distinct())})", ids.Count, users.Where(u => ids.Contains(u.Id)).ToList());
    public List<Row> CommentsIn(List<int> ids) => Run($"SELECT * FROM comments WHERE post_id IN ({string.Join(",", ids.Distinct())})", ids.Count, comments.Where(c => ids.Contains(c.PostId)).ToList());
}

class Loader(Func<List<int>, Dictionary<int, object>> batchFn, bool batch, bool cache)
{
    List<(int Key, Future F)> queue = new(); Dictionary<int, Future> memo = new(); public int Hits;
    public Future Load(int key)
    {
        if (cache && memo.TryGetValue(key, out var hit)) { Hits++; return hit; } // per-request cache
        var f = new Future();
        if (cache) memo[key] = f;
        queue.Add((key, f));
        if (!batch) Dispatch(); // not batching: one query per load
        return f;
    }
    public void Dispatch() // end of tick: one batch function call for every queued key
    {
        if (queue.Count == 0) return;
        var q = queue; queue = new();
        var found = batchFn(q.Select(x => x.Key).ToList());
        foreach (var (k, f) in q) f.Value = found.GetValueOrDefault(k);
    }
}

static class Exec
{
    // field name -> (parent row, ctx) => value or Future
    static object Resolve(string field, Row? parent, Ctx ctx) => field switch
    {
        "posts" => ctx.Db.AllPosts(),
        "comments" => ctx.Comments.Load(parent!.Id),
        _ => ctx.Users.Load(parent!.AuthorId),
    };

    public static void Execute(List<Sel> selection, List<Node> parents, Ctx ctx) // resolves one tree level at a time
    {
        var pending = selection.Select(s => parents.Select(p => Resolve(s.Name, p.Row, ctx)).ToList()).ToList(); // every resolver of this level runs first
        ctx.Users.Dispatch(); ctx.Comments.Dispatch(); // ...then the tick ends and the loaders fire
        for (var si = 0; si < selection.Count; si++)
        {
            var kids = new List<Node>();
            for (var i = 0; i < parents.Count; i++)
            {
                var v = pending[si][i] is Future f ? f.Value! : pending[si][i];
                var isList = v is List<Row>;
                var nodes = (isList ? (List<Row>)v : new List<Row> { (Row)v }).Select(r => new Node(r)).ToList();
                parents[i].Out.Add((selection[si].Name, nodes, isList));
                kids.AddRange(nodes);
            }
            Execute(selection[si].Kids, kids, ctx);
        }
    }

    public static string Ser(Node n) =>
        $"{n.Row?.Tag}{{{string.Join(";", n.Out.Select(o => $"{o.Name}:{(o.IsList ? "[" : "")}{string.Join(",", o.Kids.Select(Ser))}{(o.IsList ? "]" : "")}"))}}}";

    public static uint Fnv(string s) { uint h = 0x811c9dc5; foreach (var ch in s) h = unchecked((h ^ ch) * 16777619u); return h; }
}
