// A tiny MVCC store: versions carry xmin/xmax transaction ids, a snapshot decides visibility,
// commits use first-committer-wins, and an optional serializable check aborts "pivot" transactions.
using System;
using System.Collections.Generic;
using System.Linq;

class Abort : Exception { public Abort(string m) : base(m) { } }

class Ver { public int Value, Xmin, Xmax; }

class Txn
{
    public readonly Store Store;
    public readonly int Id, Snap;
    public readonly bool Serializable;
    public string Status = "active";
    public int Cseq;
    public HashSet<string> Reads = new();
    public Dictionary<string, int> Writes = new();

    public Txn(Store store, int id, int snap, bool serializable) { Store = store; Id = id; Snap = snap; Serializable = serializable; }

    public int Get(string key)
    {
        Reads.Add(key);
        if (Writes.TryGetValue(key, out var own)) return own;
        foreach (var v in Store.Versions.GetValueOrDefault(key) ?? new()) if (Store.Visible(v, Snap)) return v.Value;
        return 0;
    }

    public void Put(string key, int value) => Writes[key] = value; // buffered until commit

    bool ConcurrentWith(Txn o) => o != this && o.Status != "aborted" && (o.Status == "active" || o.Cseq > Snap);

    public void Commit()
    {
        var s = Store;
        foreach (var key in Writes.Keys) // first committer wins
            foreach (var v in s.Versions.GetValueOrDefault(key) ?? new())
                if (s.CommitSeq.GetValueOrDefault(v.Xmin) > Snap) { Status = "aborted"; throw new Abort("write-write conflict on " + key); }
        if (Serializable) // simplified SSI: abort a txn with both an in and an out rw-dependency
        {
            var peers = s.Txns.Where(ConcurrentWith).ToList();
            bool outDep = peers.Any(u => Reads.Any(k => u.Writes.ContainsKey(k))); // I read what a peer writes
            bool inDep = peers.Any(u => u.Reads.Any(k => Writes.ContainsKey(k))); // a peer read what I write
            if (outDep && inDep) { Status = "aborted"; throw new Abort("pivot of a read-write dependency cycle"); }
        }
        Cseq = ++s.Clock;
        s.CommitSeq[Id] = Cseq;
        foreach (var (key, value) in Writes)
        {
            if (!s.Versions.ContainsKey(key)) s.Versions[key] = new();
            var chain = s.Versions[key];
            foreach (var v in chain) if (v.Xmax == 0) v.Xmax = Id; // the old version is deleted by this txn
            chain.Add(new Ver { Value = value, Xmin = Id });
        }
        Status = "committed";
    }
}

class Store
{
    public int Clock, NextId = 1;
    public Dictionary<string, List<Ver>> Versions = new();
    public Dictionary<int, int> CommitSeq = new();
    public List<Txn> Txns = new();

    public Store(Dictionary<string, int> initial)
    {
        var setup = Begin();
        foreach (var (k, v) in initial) setup.Put(k, v);
        setup.Commit();
    }

    public Txn Begin(bool serializable = false)
    {
        var t = new Txn(this, NextId++, Clock, serializable);
        Txns.Add(t);
        return t;
    }

    public bool Visible(Ver v, int snap)
    {
        int c = CommitSeq.GetValueOrDefault(v.Xmin);
        int d = v.Xmax == 0 ? 0 : CommitSeq.GetValueOrDefault(v.Xmax);
        return c > 0 && c <= snap && !(d > 0 && d <= snap);
    }

    public string Chain(string key) => string.Join(" ", Versions[key].Select(v => $"({v.Value},xmin={v.Xmin},xmax={v.Xmax})"));
}

static class Program
{
    static void TryCommit(string name, Txn t)
    {
        try { t.Commit(); Console.WriteLine($"{name} commit: ok"); }
        catch (Abort e) { Console.WriteLine($"{name} commit: abort ({e.Message})"); }
    }

    static int WriteSkew(bool serializable)
    {
        var db = new Store(new() { ["alice"] = 1, ["bob"] = 1 }); // two doctors on call; the rule: at least one must stay
        var t1 = db.Begin(serializable);
        var t2 = db.Begin(serializable);
        foreach (var (name, t, me) in new[] { ("T1", t1, "alice"), ("T2", t2, "bob") })
        {
            int n = t.Get("alice") + t.Get("bob");
            Console.WriteLine($"{name} sees {n} on call" + (n >= 2 ? $", {me} goes off call" : ""));
            if (n >= 2) t.Put(me, 0);
        }
        TryCommit("T1", t1);
        TryCommit("T2", t2);
        var check = db.Begin();
        int onCall = check.Get("alice") + check.Get("bob");
        Console.WriteLine($"on call now: {onCall}; alice {db.Chain("alice")}");
        return onCall;
    }

    static void Main()
    {
        Console.WriteLine("== write skew under snapshot isolation ==");
        if (WriteSkew(false) != 0) throw new Exception("expected the anomaly"); // the invariant is broken: nobody is on call
        Console.WriteLine("== write skew with the serializable check ==");
        if (WriteSkew(true) != 1) throw new Exception("expected one on call"); // one transaction was aborted, the rule holds

        Console.WriteLine("== lost update under snapshot isolation ==");
        var db = new Store(new() { ["acct"] = 100 });
        var t1 = db.Begin();
        var t2 = db.Begin();
        t1.Put("acct", t1.Get("acct") + 50);
        t2.Put("acct", t2.Get("acct") - 30);
        TryCommit("T1", t1);
        TryCommit("T2", t2);
        int balance = db.Begin().Get("acct");
        Console.WriteLine($"balance: {balance}; acct {db.Chain("acct")}");
        if (balance != 150 || t2.Status != "aborted") throw new Exception("lost update not prevented"); // the aborted T2 retries and gets 120
    }
}
