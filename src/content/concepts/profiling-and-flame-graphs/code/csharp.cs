// Build a call tree from sampled stacks (collapsed format "a;b;c count"),
// compute self and total time per function, print a text flame graph and
// check the sampled estimate against the known true proportions.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

class Node
{
    public string Name; public long SelfN, Total;
    public SortedDictionary<string, Node> Kids = new(StringComparer.Ordinal);
    public Node(string name) { Name = name; }
}

class Program
{
    static readonly (string, long)[] Base = {
        ("handler", 160), ("handler;auth", 120), ("handler;route", 80),
        ("handler;parse", 60), ("handler;parse;regex_match", 100),
        ("handler;db_query", 50), ("handler;db_query;driver_decode", 90),
        ("handler;serialize", 50), ("handler;serialize;json_encode", 90),
        ("handler;serialize;json_encode;encode_loop", 170),
        ("handler;audit_log", 30),
    };

    static (string, long)[] Truth(bool regressed) =>
        Base.Select(b => (b.Item1, b.Item1.EndsWith("encode_loop") && regressed ? b.Item2 + 1000 : b.Item2)).ToArray();

    // MINSTD: x = x * 48271 mod (2^31 - 1)
    static SortedDictionary<string, long> Sample((string, long)[] stacks, int n, long seed)
    {
        long total = stacks.Sum(s => s.Item2), x = seed;
        var counts = new SortedDictionary<string, long>(StringComparer.Ordinal);
        for (int i = 0; i < n; i++)
        {
            x = x * 48271 % 2147483647;
            long r = x % total;
            foreach (var (s, w) in stacks)
            {
                if (r < w) { counts[s] = counts.GetValueOrDefault(s) + 1; break; }
                r -= w;
            }
        }
        return counts;
    }

    static string Collapsed(SortedDictionary<string, long> c) => string.Join("\n", c.Select(kv => $"{kv.Key} {kv.Value}"));

    static Node Build(string text)
    {
        var root = new Node("(all)");
        foreach (var line in text.Split('\n'))
        {
            int at = line.LastIndexOf(' ');
            long count = long.Parse(line.Substring(at + 1));
            var node = root; root.Total += count;
            foreach (var frame in line.Substring(0, at).Split(';'))
            {
                if (!node.Kids.TryGetValue(frame, out var kid)) node.Kids[frame] = kid = new Node(frame);
                node = kid; node.Total += count;
            }
            node.SelfN += count;
        }
        return root;
    }

    static string Pct(long n, long total) { long p = n * 1000 / total; return $"{p / 10}.{p % 10}"; }

    static void Flame(Node node, long total, int depth, List<string> o)
    {
        string bar = new string('#', (int)Math.Max(1, node.Total * 40 / total));
        o.Add($"{(new string(' ', depth * 2) + node.Name),-34} {bar,-40} {Pct(node.Total, total),5}% self {Pct(node.SelfN, total),5}%");
        foreach (var k in node.Kids.Values) Flame(k, total, depth + 1, o);
    }

    static void Check(Node n)
    {
        if (n.Total != n.SelfN + n.Kids.Values.Sum(k => k.Total)) throw new Exception("totals do not add up");
        foreach (var k in n.Kids.Values) Check(k);
    }

    static Dictionary<string, long> SelfByFunction(Node root)
    {
        var acc = new Dictionary<string, long>(); var stack = new Stack<Node>(); stack.Push(root);
        while (stack.Count > 0)
        {
            var n = stack.Pop();
            if (n != root) acc[n.Name] = acc.GetValueOrDefault(n.Name) + n.SelfN;
            foreach (var k in n.Kids.Values) stack.Push(k);
        }
        return acc;
    }

    static void Assert(bool ok, string msg) { if (!ok) throw new Exception(msg); }

    static void Main()
    {
        const int N = 6000;
        var root = Build(Collapsed(Sample(Truth(true), N, 7)));
        Check(root);
        Assert(root.Total == N && SelfByFunction(root).Values.Sum() == N, "samples lost");
        Console.WriteLine($"flame graph, {N} samples at 100 Hz (width = share, not time):");
        var lines = new List<string>(); Flame(root, N, 0, lines);
        Console.WriteLine(string.Join("\n", lines));
        var sv = root.Kids["handler"].Kids["serialize"];
        Console.WriteLine($"serialize: total {Pct(sv.Total, N)}% but self {Pct(sv.SelfN, N)}%");

        var real = Truth(true);
        long tt = real.Sum(s => s.Item2);
        var trueSelf = real.ToDictionary(s => s.Item1.Split(';').Last(), s => s.Item2);
        Console.WriteLine($"\nestimate error for audit_log (true {Pct(trueSelf["audit_log"], tt)}%):");
        foreach (int n in new[] { 100, 1000, 10000, 60000 })
        {
            var est = SelfByFunction(Build(Collapsed(Sample(real, n, 7))));
            long k = est.GetValueOrDefault("audit_log"), worst = 0;
            foreach (var (f, w) in trueSelf)
            {
                long num = Math.Abs(est.GetValueOrDefault(f) * tt - w * n);
                double p = (double)w / tt;
                Assert((double)num / ((double)n * tt) <= 5 * Math.Sqrt(p * (1 - p) / n) + 1.0 / n, "error outside 5 sigma");
                worst = Math.Max(worst, num);
            }
            Console.WriteLine($"n={n,5}  audit_log samples={k,4}  est {Pct(k, n),5}%  worst error over all functions {Pct(worst, (long)n * tt)} pts");
        }

        long baseTot = Truth(false).Sum(s => s.Item2);
        Console.WriteLine($"\nregression: total {baseTot} -> {tt} us per request, encode_loop share {Pct(170, baseTot)}% -> {Pct(1170, tt)}%");
        Assert(tt == baseTot + 1000, "regression adds 1000");
    }
}
