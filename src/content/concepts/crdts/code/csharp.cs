// G-Counter, PN-Counter and OR-Set as state-based CRDTs, plus a naive last-write-wins counter for contrast.
// Merge() is commutative, associative and idempotent, so any delivery order, with duplicates, converges.
using System;
using System.Collections.Generic;
using System.Linq;

abstract class Crdt
{
    public virtual void Inc(int r, int ts) { }
    public virtual void Dec(int r, int ts) { }
    public virtual void Add(int r, string el) { }
    public virtual void Remove(int r, string el) { }
    public abstract Crdt Merge(Crdt o);
    public abstract string Value();
    public abstract string Key();
    public abstract int Size();
    protected static int[] Max(int[] a, int[] b) => a.Select((x, i) => Math.Max(x, b[i])).ToArray();
}

class LWWCounter(int v = 10, int ts = 0, int by = 0) : Crdt // naive: one number and a timestamp, newest write wins
{
    int v = v, ts = ts, by = by;
    public override void Inc(int r, int t) { v += 1; ts = t; by = r; }
    public override void Dec(int r, int t) { v -= 1; ts = t; by = r; }
    public override Crdt Merge(Crdt o)
    {
        var x = (LWWCounter)o;
        var w = (x.ts > ts || (x.ts == ts && x.by > by)) ? x : this;
        return new LWWCounter(w.v, w.ts, w.by);
    }
    public override string Value() => v.ToString();
    public override string Key() => $"{v}@{ts}";
    public override int Size() => 2;
}

class GCounter(int[]? init = null) : Crdt // one slot per replica, merge = element-wise max
{
    readonly int[] p = (int[])(init ?? [4, 3, 3]).Clone();
    public override void Inc(int r, int ts) { p[r] += 1; }
    public override Crdt Merge(Crdt o) => new GCounter(Max(p, ((GCounter)o).p));
    public override string Value() => p.Sum().ToString();
    public override string Key() => "[" + string.Join(",", p) + "]";
    public override int Size() => p.Length;
}

class PNCounter(int[]? ip = null, int[]? inn = null) : Crdt // two G-Counters: increments and decrements
{
    readonly int[] p = (int[])(ip ?? [4, 3, 3]).Clone(), n = (int[])(inn ?? [0, 0, 0]).Clone();
    public override void Inc(int r, int ts) { p[r] += 1; }
    public override void Dec(int r, int ts) { n[r] += 1; }
    public override Crdt Merge(Crdt o) { var x = (PNCounter)o; return new PNCounter(Max(p, x.p), Max(n, x.n)); }
    public override string Value() => (p.Sum() - n.Sum()).ToString();
    public override string Key() => "P[" + string.Join(",", p) + "]N[" + string.Join(",", n) + "]";
    public override int Size() => p.Length + n.Length;
}

class ORSet(Dictionary<string, string>? adds = null, IEnumerable<string>? rem = null, int seq = 0) : Crdt
{
    // adds carry unique tags; remove tombstones only the tags it has observed
    readonly Dictionary<string, string> adds = new(adds ?? new() { ["A0"] = "urgent" });
    readonly HashSet<string> rem = new(rem ?? []);
    int seq = seq;
    public override void Add(int r, string el) { adds["ABC"[r] + seq.ToString()] = el; seq += 1; }
    public override void Remove(int r, string el) { foreach (var (t, e) in adds) if (e == el) rem.Add(t); }
    public override Crdt Merge(Crdt o)
    {
        var x = (ORSet)o;
        var all = new Dictionary<string, string>(adds);
        foreach (var (t, e) in x.adds) all[t] = e;
        return new ORSet(all, rem.Union(x.rem), seq);
    }
    public override string Value() => string.Join(",", adds.Where(kv => !rem.Contains(kv.Key)).Select(kv => kv.Value).Distinct().OrderBy(s => s, StringComparer.Ordinal));
    public override string Key() => string.Join(";", adds.Select(kv => $"{kv.Key}={kv.Value}").OrderBy(s => s, StringComparer.Ordinal)) + "|" + string.Join(",", rem.OrderBy(s => s, StringComparer.Ordinal));
    public override int Size() => adds.Count + rem.Count;
}

static class Program
{
    static (Crdt[], int?) Counters(Func<Crdt> make, bool withDec)
    {
        var reps = new[] { make(), make(), make() };
        (int r, int d)[] script = [(0, 1), (1, 1), (2, 1), (0, 1), (1, 1), (2, 1), (0, 1), (1, 1), (1, 1), (1, 1), (2, 1), (2, -1)];
        int net = 10;
        for (int i = 0; i < script.Length; i++)
        {
            var (r, d) = script[i];
            if (d > 0) { reps[r].Inc(r, (i + 1) * 100); net += 1; }
            else if (withDec) { reps[r].Dec(r, (i + 1) * 100); net -= 1; }
        }
        return (reps, net);
    }

    static (Crdt[], int?) Sets(Func<Crdt> make, bool _)
    {
        var reps = new[] { make(), make(), make() };
        reps[0].Remove(0, "urgent"); // A removes the tag it has seen...
        reps[1].Add(1, "urgent");    // ...while B concurrently adds it again, under a new unique tag
        reps[2].Add(2, "billing");
        return (reps, null);
    }

    static IEnumerable<int[]> Permutations(int[] a) =>
        a.Length <= 1 ? [a] : a.SelectMany((x, i) => Permutations(a.Where((_, k) => k != i).ToArray()).Select(p => new[] { x }.Concat(p).ToArray()));

    static void Check(bool ok, string msg) { if (!ok) throw new Exception(msg); }

    static (string, int?) Converge(string name, Func<Crdt> make, Func<Func<Crdt>, bool, (Crdt[], int?)> build, bool withDec = true)
    {
        var keys = new HashSet<string>(); var values = new HashSet<string>(); var sizes = new HashSet<int>();
        int? expected = null;
        foreach (var perm in Permutations([0, 1, 2])) // 6 merge orders
        {
            Crdt[] reps;
            (reps, expected) = build(make, withDec);
            var snaps = reps.Select(r => r.Merge(r)).ToArray(); // copies, replayed later as stale messages
            for (int round = 0; round < 2; round++) // every pull is delivered twice
                foreach (var i in perm) foreach (var j in perm) if (i != j) reps[i] = reps[i].Merge(reps[j]);
            var before = string.Join("#", reps.Select(r => r.Key()));
            for (int i = 0; i < 3; i++) foreach (var s in snaps) reps[i] = reps[i].Merge(s);
            Check(before == string.Join("#", reps.Select(r => r.Key())), "stale replay changed a state");
            Check(reps.Select(r => r.Key()).Distinct().Count() == 1, "replicas diverged");
            keys.Add(reps[0].Key()); values.Add(reps[0].Value()); sizes.Add(reps[0].Size());
        }
        Check(keys.Count == 1, "order changed the result");
        var value = values.First();
        Console.WriteLine($"{name}: 6 orders x duplicates -> {value} state={keys.First()} size={sizes.First()} expected={(expected?.ToString() ?? "-")}");
        return (value, expected);
    }

    static void Main()
    {
        var (v, e) = Converge("G-Counter ", () => new GCounter(), Counters, false);
        Check(int.Parse(v) == 21 && e == 21, "G-Counter");
        (v, e) = Converge("PN-Counter", () => new PNCounter(), Counters);
        Check(int.Parse(v) == 20 && e == 20, "PN-Counter");
        (v, e) = Converge("LWW counter", () => new LWWCounter(), Counters);
        Console.WriteLine($"  naive LWW shows {v} instead of {e}: {e - int.Parse(v)} increments lost");
        Check(int.Parse(v) == 12 && e - int.Parse(v) == 8, "LWW should lose increments");
        (v, _) = Converge("OR-Set    ", () => new ORSet(), Sets);
        Check(v == "billing,urgent", "add wins"); // B's concurrent add survives A's remove

        var s = new ORSet(null, null, 1); // A already used tag A0 for the first 'urgent'
        for (int i = 0; i < 5; i++) { s.Add(0, "vip"); s.Remove(0, "vip"); }
        Console.WriteLine($"OR-Set after 5 add/remove cycles: value='{s.Value()}' size={s.Size()} (tombstones grow until garbage collected)");
        Check(s.Value() == "urgent" && s.Size() == 11, "tombstone growth");
    }
}
