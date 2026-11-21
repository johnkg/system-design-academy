// A reconciliation run over 3 days of card payments, three sources (ledger, processor files, bank deposits), with
// injected breaks: a late file, a duplicate file, a corrected file, missing rows, lost references, fee differences,
// refunds and chargebacks, and processors that cut the day off in different time zones.
// Money is integer cents and the "random" payments come from a seeded generator, so the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Day = 1440;                 // minutes in a day
    const int PerDay = 200, Days = 3;     // payments per day, days of payments (UTC days 1 to 3)
    const int Buckets = 5;                // business days 0 to 4: refunds and chargebacks land later, and time zones shift the day
    static readonly int[] Offset = { 0, 60, -480 }; // minutes from UTC where each processor cuts the day: UTC, UTC+1, UTC-8
    const long Seed = 20260115;
    const int RefundAfter = 1500, ChargebackAfter = 2900; // minutes after the payment

    static long seed = Seed;
    static int Next(int n) { seed = seed * 48271 % 2147483647; return (int)(seed % n); } // Park-Miller, the same in every language
    static int Fee(int amount) => (amount * 29 + 500) / 1000 + 30;                        // 2.9% plus 30 cents, rounded half up

    // One line of money: a sale (0), a refund (1) or a chargeback (2). Ref is false when the processor lost the reference.
    class Line
    {
        public int Pid, Type, T, Net, Tail, Proc, Age; public bool Ref, Big;
        public Line Copy(int net, bool big) => new Line { Pid = Pid, Type = Type, T = T, Net = net, Tail = Tail, Proc = Proc, Ref = Ref, Big = big };
    }
    static Line Mk(int pid, int type, int t, int net, int tail, int proc, bool rf, bool big) => new Line { Pid = pid, Type = type, T = t, Net = net, Tail = tail, Proc = proc, Ref = rf, Big = big };
    static int Key(Line l) => l.Pid * 3 + l.Type;
    static int Sum(IEnumerable<Line> ls, Func<Line, int> f) => ls.Sum(f);

    static void Run(string name, string strategy, int tolerance, bool idempotent, bool perProcessorCutoff)
    {
        seed = Seed;
        var ledger = new List<Line>(); var truth = new List<Line>(); // ledger lines, and what the processors really reported
        for (int i = 0; i < Days * PerDay; i++)
        {
            int day = 1 + i / PerDay;
            int t = day * Day + Next(Day), amount = 500 + Next(19501), tail = Next(10000), proc = Next(3);
            int r = Next(100), small = 1 + Next(4), large = 200 + Next(101);
            string kind = r < 2 ? "missing" : r < 3 ? "ghost" : r < 6 ? "lost" : r < 14 ? "fee" : r < 15 ? "bigfee" : r < 17 ? "chargeback" : r < 20 ? "refund" : "normal";
            if (kind == "chargeback" && day != 1) kind = "normal";
            if (kind == "refund" && day > 2) kind = "normal";
            int expected = amount - Fee(amount);
            if (kind != "ghost") ledger.Add(Mk(i, 0, t, expected, tail, proc, true, false));
            if (kind == "refund") ledger.Add(Mk(i, 1, t + RefundAfter, -amount, tail, proc, true, false));
            if (kind != "missing")
            {
                int net = kind == "fee" ? expected - small : kind == "bigfee" ? expected - large : expected;
                truth.Add(Mk(i, 0, t, net, tail, proc, kind != "lost", kind == "bigfee"));
                if (kind == "refund") truth.Add(Mk(i, 1, t + RefundAfter, -amount, tail, proc, true, false));
                if (kind == "chargeback") truth.Add(Mk(i, 2, t + ChargebackAfter, -amount, tail, proc, true, false));
            }
        }

        List<Line>[][] Grid() => Enumerable.Range(0, 3).Select(_ => Enumerable.Range(0, Buckets).Select(__ => new List<Line>()).ToArray()).ToArray();
        var lb = Grid(); var tb = Grid();
        foreach (var l in ledger) lb[l.Proc][(l.T + (perProcessorCutoff ? Offset[l.Proc] : 0)) / Day].Add(l);
        foreach (var l in truth) tb[l.Proc][(l.T + Offset[l.Proc]) / Day].Add(l);
        // What the loader has stored for each processor and day. An idempotent load keeps one version of each row.
        var pb = Grid();
        for (int p = 0; p < 3; p++) for (int b = 0; b < Buckets; b++) pb[p][b] = tb[p][b].Select(l => l.Copy(l.Net, l.Big)).ToList();
        int duplicateMoney = 0;
        if (!idempotent)
        {
            pb[1][3] = pb[1][3].Concat(pb[1][1]).ToList(); pb[1][1] = new List<Line>(); // late file: arrives 2 days after its day
            duplicateMoney += Sum(pb[2][2], l => Math.Abs(l.Net));
            pb[2][2] = pb[2][2].Concat(pb[2][2].Select(l => l.Copy(l.Net, l.Big)).ToList()).ToList(); // the same file delivered twice, both loaded
            pb[0][2] = tb[0][2].Select(l => l.Pid % 5 == 0 ? l.Copy(l.Net + 1000, true) : l.Copy(l.Net, l.Big)).ToList(); // first version, 1 row in 5 wrong
            pb[0][3] = pb[0][3].Concat(tb[0][2].Select(l => l.Copy(l.Net, l.Big))).ToList(); // the corrected file, loaded next to it
            duplicateMoney += Sum(tb[0][2], l => Math.Abs(l.Net));
        }
        int notTying = 0;
        for (int p = 0; p < 3; p++) for (int b = 0; b < Buckets; b++) if (Sum(pb[p][b], l => l.Net) != Sum(tb[p][b], l => l.Net)) notTying++;

        bool single = strategy == "single"; int window = single ? 0 : 1;
        int matched = 0, resolved = 0, falsePairs = 0, wrongMoney = 0;
        var breaks = new List<(string Cls, int Cents)>();
        for (int p = 0; p < 3; p++)
        {
            var paired = new int[Days * PerDay * 3]; // 1: key paired cleanly, 2: key paired with a wrong amount
            var carryL = new List<Line>(); var carryP = new List<Line>();
            var miss = new List<Line>(); var orphan = new List<Line>();
            for (int b = 0; b < Buckets; b++)
            {
                var ls = carryL.Concat(lb[p][b]).ToList(); var ps = carryP.Concat(pb[p][b]).ToList();
                carryL = new List<Line>(); carryP = new List<Line>();
                var uL = new bool[ls.Count]; var uP = new bool[ps.Count];
                for (int i = 0; i < ls.Count; i++) // tiers 1 and 2: same reference, exact amount or within tolerance
                {
                    for (int j = 0; j < ps.Count; j++)
                    {
                        if (uP[j] || !ps[j].Ref || Key(ps[j]) != Key(ls[i])) continue;
                        uL[i] = uP[j] = true;
                        int diff = Math.Abs(ls[i].Net - ps[j].Net);
                        if (diff == 0) { matched++; paired[Key(ls[i])] = 1; }
                        else if (!single && diff <= tolerance) { matched++; resolved++; paired[Key(ls[i])] = 1; if (ps[j].Big) wrongMoney += diff; }
                        else { breaks.Add(("amount", diff)); paired[Key(ls[i])] = 2; }
                        break;
                    }
                }
                for (int j = 0; j < ps.Count; j++) // a second row for a reference that is already paired
                {
                    if (uP[j] || !ps[j].Ref || paired[Key(ps[j])] == 0) continue;
                    uP[j] = true;
                    if (!single && paired[Key(ps[j])] == 1) resolved++; else breaks.Add(("duplicate", Math.Abs(ps[j].Net)));
                }
                if (!single) // tier 3: fuzzy, on amount, card tail and type
                {
                    for (int i = 0; i < ls.Count; i++)
                    {
                        if (uL[i]) continue;
                        for (int j = 0; j < ps.Count; j++)
                        {
                            var x = ps[j];
                            if (uP[j] || x.Type != ls[i].Type || Math.Abs(ls[i].Net - x.Net) > tolerance) continue;
                            if (strategy == "tiered" && (x.Ref || x.Tail != ls[i].Tail)) continue;
                            uL[i] = uP[j] = true; matched++;
                            if (x.Pid != ls[i].Pid) { falsePairs++; wrongMoney += Math.Abs(ls[i].Net); } else resolved++;
                            break;
                        }
                    }
                }
                for (int i = 0; i < ls.Count; i++) if (!uL[i]) { if (window == 1 && ls[i].Age == 0 && b < Buckets - 1) { ls[i].Age = 1; carryL.Add(ls[i]); } else miss.Add(ls[i]); }
                for (int j = 0; j < ps.Count; j++) if (!uP[j]) { if (window == 1 && ps[j].Age == 0 && b < Buckets - 1) { ps[j].Age = 1; carryP.Add(ps[j]); } else orphan.Add(ps[j]); }
            }
            var used = new bool[orphan.Count];
            foreach (var l in miss) // a line missing on one side and extra on the other is a timing break
            {
                int j = -1;
                for (int k = 0; k < orphan.Count; k++) if (!used[k] && orphan[k].Ref && orphan[k].Pid == l.Pid && orphan[k].Type == l.Type) { j = k; break; }
                if (j >= 0) { used[j] = true; breaks.Add(("timing", Math.Abs(l.Net))); } else breaks.Add(("missing", Math.Abs(l.Net)));
            }
            for (int k = 0; k < orphan.Count; k++) if (!used[k]) breaks.Add((orphan[k].Type == 2 ? "status" : "missing", Math.Abs(orphan[k].Net)));
        }
        int Count(string c) => breaks.Count(x => x.Cls == c);
        int total = ledger.Count;
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  matched {matched * 100 / total}% ({matched} of {total} ledger lines), {resolved} resolved by rules");
        Console.WriteLine($"  breaks for people {breaks.Count}: timing {Count("timing")}, missing {Count("missing")}, amount {Count("amount")}, duplicate {Count("duplicate")}, status {Count("status")}");
        Console.WriteLine($"  unexplained {breaks.Sum(x => x.Cents)} cents, duplicate-counted {duplicateMoney} cents, bank deposits not tying {notTying} of 15");
        Console.WriteLine($"  wrongly matched {falsePairs} pairs, {wrongMoney} cents marked reconciled but wrong");
    }

    public static void Main()
    {
        Run("single pass on exact id, files appended, UTC cut-off", "single", 0, false, false);
        Run("single pass, each processor on its own time zone", "single", 0, false, true);
        Run("single pass, time zones, idempotent loads", "single", 0, true, true);
        Run("tiered rules, tolerance 5, time zones, idempotent loads", "tiered", 5, true, true);
        Run("tiered rules, tolerance 5, files appended, UTC cut-off", "tiered", 5, false, false);
        Run("loose fuzzy, tolerance 1000, time zones, idempotent loads", "loose", 1000, true, true);
        Run("tiered rules, tolerance 1000, time zones, idempotent loads", "tiered", 1000, true, true);
    }
}
