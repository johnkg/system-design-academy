// Reconciliation: match your records with the payment provider's, classify what does not agree, count the money at stake.
// 200 generated transactions with injected breaks from a seeded generator, so every run prints the same text. Integers only.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long Seed = 20261128;
    const int Count = 200;
    static readonly long[] Prices = { 499, 999, 1999, 4900 }; // few distinct prices on purpose: many payments look alike, so a fuzzy match can pick the wrong one
    const int Days = 7;                                       // transactions fall on days 1 to 7
    static readonly string[] Classes = { "timing shift", "missing at provider", "missing in our records", "duplicate", "amount off by fee", "status differs", "no reference id" };

    class Row
    {
        public string Id = "", TrueId = "", Status = "";
        public long Amount; public int Day;
        public Row Copy() => (Row)MemberwiseClone();
    }

    // The provider's fee: 2.9% (half up) plus 30 cents.
    static long FeeOf(long amount) => (amount * 290 + 5000) / 10000 + 30;

    // A small seeded generator (Park-Miller): the same seed always gives the same numbers.
    class Rng
    {
        long s;
        public Rng(long seed) { s = seed; }
        public int Next(int n) { s = (s * 48271) % 2147483647; return (int)(s % n); }
    }

    // Your records and the provider's records of the same payments, with breaks injected at ratePct percent.
    static (List<Row> Ours, List<Row> Provider, int[] Injected) Generate(int ratePct)
    {
        var r = new Rng(Seed);
        var ours = new List<Row>(); var provider = new List<Row>(); var injected = new int[Classes.Length];
        for (int i = 1; i <= Count; i++)
        {
            string id = "T" + i.ToString().PadLeft(4, '0');
            long amount = Prices[r.Next(Prices.Length)];
            int day = 1 + r.Next(Days);
            string status = r.Next(100) < 15 ? "refunded" : "captured";
            bool broken = r.Next(100) < ratePct;
            int cls = r.Next(Classes.Length); // always drawn, so a higher rate only adds breaks
            var row = new Row { Id = id, TrueId = id, Amount = amount, Day = day, Status = status };
            var mine = new Row { Id = id, Amount = amount, Day = day, Status = status };
            int kind = broken ? cls : -1;
            if (broken) injected[cls]++;
            if (kind != 2) ours.Add(mine);          // missing in our records: the provider has it, we never wrote it down
            if (kind == 1) continue;                // missing at provider: no row on their side
            if (kind == 0) row.Day = day + 1;       // paid at 23:59, booked by the provider the next day
            if (kind == 4) row.Amount = amount - FeeOf(amount); // the provider reports the amount net of its fee
            if (kind == 5) row.Status = status == "captured" ? "refunded" : "captured";
            if (kind == 6) row.Id = "";             // the reference did not make it into the provider's file
            provider.Add(row);
            if (kind == 3) provider.Add(row.Copy()); // the same payment delivered twice
        }
        return (ours, provider, injected);
    }

    static bool FeeOk(Row o, Row p) => p.Amount <= o.Amount && o.Amount - p.Amount <= FeeOf(o.Amount);

    // rule: "id" (the id alone), "fee" (id, and the amount may be lower by the fee), "window" (id, and the date within n days),
    // "fuzzy" (id; rows without an id are matched by amount and a date within n days).
    static (int Matched, int Correct, int UnmatchedO, int UnmatchedP, long Difference, long Unexplained, SortedDictionary<string, List<string>> Exceptions)
        Reconcile(List<Row> ours, List<Row> provider, string rule, int n)
    {
        var byId = ours.ToDictionary(o => o.Id);
        var matchedOurs = new HashSet<string>(); var pairs = new List<(Row O, Row P)>(); var unmatchedP = new List<Row>(); var deferred = new List<Row>();
        foreach (var p in provider)
        {
            if (p.Id == "") { deferred.Add(p); continue; }
            if (!byId.TryGetValue(p.Id, out var o) || matchedOurs.Contains(o.Id)) { unmatchedP.Add(p); continue; } // unknown id, or a second row for an id already matched
            bool ok = rule == "fee" ? FeeOk(o, p) : rule == "window" ? Math.Abs(p.Day - o.Day) <= n : true;
            if (ok) { matchedOurs.Add(o.Id); pairs.Add((o, p)); } else unmatchedP.Add(p);
        }
        foreach (var p in deferred)
        {
            if (rule != "fuzzy") { unmatchedP.Add(p); continue; }
            Row? best = null;
            foreach (var o in ours)
            {
                if (matchedOurs.Contains(o.Id) || o.Amount != p.Amount || Math.Abs(o.Day - p.Day) > n) continue;
                if (best == null || Math.Abs(o.Day - p.Day) < Math.Abs(best.Day - p.Day)) best = o; // closest date, then the lowest id
            }
            if (best != null) { matchedOurs.Add(best.Id); pairs.Add((best, p)); } else unmatchedP.Add(p);
        }
        var unmatchedO = ours.Where(o => !matchedOurs.Contains(o.Id)).ToList();

        // Classify what is left, from what can be seen in the two files.
        var exceptions = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        void Add(string cls, string text) { if (!exceptions.ContainsKey(cls)) exceptions[cls] = new List<string>(); exceptions[cls].Add(text); }
        var usedP = new HashSet<int>();
        foreach (var o in unmatchedO)
        {
            int k = unmatchedP.FindIndex(x => x.Id == o.Id && !usedP.Contains(unmatchedP.IndexOf(x)));
            if (k >= 0) { usedP.Add(k); Add("same id, rejected by the rule", o.Id); } else Add("missing at provider", o.Id);
        }
        for (int i = 0; i < unmatchedP.Count; i++)
        {
            if (usedP.Contains(i)) continue;
            var p = unmatchedP[i];
            if (p.Id == "") Add("no reference id", $"{p.Amount} on day {p.Day}");
            else if (matchedOurs.Contains(p.Id)) Add("duplicate", p.Id);
            else Add("missing in our records", p.Id);
        }
        foreach (var (o, p) in pairs)
        {
            if (o.Day != p.Day) Add("date differs", o.Id);
            if (o.Amount != p.Amount && !(rule == "fee" && p.Amount < o.Amount && o.Amount - p.Amount <= FeeOf(o.Amount))) Add("amount differs", o.Id);
            if (o.Status != p.Status) Add("status differs", o.Id);
        }
        int correct = pairs.Count(x => x.O.Id == x.P.TrueId);
        long unexplained = unmatchedO.Sum(x => x.Amount) + unmatchedP.Sum(x => x.Amount);
        foreach (var (o, p) in pairs)
        {
            bool tolerated = rule == "fee" && FeeOk(o, p);
            if (!tolerated) unexplained += Math.Abs(o.Amount - p.Amount);
        }
        return (pairs.Count, correct, unmatchedO.Count, unmatchedP.Count, ours.Sum(x => x.Amount) - provider.Sum(x => x.Amount), unexplained, exceptions);
    }

    public static void Main()
    {
        var rules = new[] { ("id", "exact id only"), ("fee", "id and amount within the fee"), ("window", "id and date within the window"), ("fuzzy", "id, then fuzzy by amount and date") };
        foreach (int ratePct in new[] { 0, 10, 25 })
        {
            var (ours, provider, injected) = Generate(ratePct);
            Console.WriteLine($"-- break rate {ratePct}%: {ours.Count} of our records, {provider.Count} of the provider's, {injected.Sum()} breaks injected");
            Console.WriteLine("  injected: " + string.Join(", ", Classes.Select((c, i) => $"{c} {injected[i]}")));
            foreach (var (rule, label) in rules)
            {
                foreach (int n in rule == "id" || rule == "fee" ? new[] { 1 } : new[] { 0, 1, 3 })
                {
                    if (ratePct == 0 && n != 1) continue;
                    var x = Reconcile(ours, provider, rule, n);
                    string ex = x.Exceptions.Count > 0 ? string.Join(", ", x.Exceptions.Select(kv => $"{kv.Key} {kv.Value.Count}")) : "none";
                    string suffix = rule == "window" || rule == "fuzzy" ? $" ({n} days)" : "";
                    Console.WriteLine($"  {label}{suffix}: matched {x.Matched} (false {x.Matched - x.Correct}), unmatched ours {x.UnmatchedO}, provider {x.UnmatchedP}; money difference {x.Difference}, unexplained {x.Unexplained}; {ex}");
                }
            }
        }
    }
}
