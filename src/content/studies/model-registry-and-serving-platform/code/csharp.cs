// A model registry in C#: immutable checksummed versions, gated promotion with approval,
// rollback, a sticky canary traffic split, and the scale-from-zero arithmetic.
using System;
using System.Collections.Generic;
using System.Linq;

var reg = new Registry();
var v1 = reg.Publish("weights-alpha", "ana"); var v2 = reg.Publish("weights-beta", "ana"); var v3 = reg.Publish("weights-gamma", "ana");
Console.WriteLine($"published v1={v1.Sum} v2={v2.Sum} v3={v3.Sum}; same bytes again gives v{reg.Publish("weights-beta", "ana").N}");
Console.WriteLine(reg.Stage(1, 912, 80) + " | " + reg.Promote(1, "bob"));
Console.WriteLine(reg.Stage(2, 925, 95) + " | " + reg.Promote(2, "ana") + " | " + reg.Promote(2, "bob"));
Console.WriteLine(reg.Stage(3, 931, 160));
Console.WriteLine($"tampered copy of v2 passes the checksum: {(Registry.Checksum("weights-beta!") == v2.Sum).ToString().ToLower()}");

// A request id always lands on the same side, and raising the canary share only moves requests onto the canary.
bool ToCanary(int id, int pct) => Registry.Fnv($"req-{id}") % 100 < pct;
int at10 = 0, at25 = 0; bool sticky = true, nested = true;
for (int i = 0; i < 10000; i++)
{
    bool a = ToCanary(i, 10), b = ToCanary(i, 25);
    if (a) at10++;
    if (b) at25++;
    if (a != ToCanary(i, 10)) sticky = false;
    if (a && !b) nested = false;
}
Console.WriteLine($"canary share: {at10} of 10000 at 10%, {at25} at 25%; sticky {sticky.ToString().ToLower()}; nested {nested.ToString().ToLower()}");

// Scale from zero: a cold replica pays 6 s of start-up plus the weight download. Replicas follow the queue at 8 requests each.
int ColdStart(int sizeMb, int mbPerSec) => 6 + (int)Math.Ceiling((double)sizeMb / mbPerSec);
int Replicas(int queue) => (int)Math.Ceiling(queue / 8.0);
Console.WriteLine($"cold start for 14000 MB: {ColdStart(14000, 1000)} s from the network, {ColdStart(14000, 5000)} s from a local cache; replicas for queue 0, 5, 50: {string.Join(", ", new[] { 0, 5, 50 }.Select(Replicas))}");

Console.WriteLine(reg.Rollback());
if (reg.Production()!.N != 1 || at10 < 800 || at10 > 1200 || !sticky || !nested || Registry.Checksum("weights-beta!") == v2.Sum) Environment.Exit(1);

class Ver
{
    public int N; public string Weights = "", Sum = "", Author = "", Stage = "none"; public int Acc, P95;
}

class Registry
{
    List<Ver> versions = new();

    // 32-bit FNV-1a hash, used here as the checksum of the weights and as the traffic-split hash.
    public static uint Fnv(string s) { uint h = 2166136261; foreach (char c in s) { h ^= c; h *= 16777619; } return h; }
    public static string Checksum(string weights) => Fnv(weights).ToString("x8");

    // Publishing the same bytes again returns the existing version, so a retried upload creates no duplicate.
    public Ver Publish(string weights, string author)
    {
        string sum = Checksum(weights);
        var found = versions.FirstOrDefault(v => v.Sum == sum);
        if (found != null) return found;
        var v = new Ver { N = versions.Count + 1, Weights = weights, Sum = sum, Author = author };
        versions.Add(v);
        return v;
    }

    // The eval gate: accuracy (per mille) must not drop more than 5 below production, and p95 latency must stay at or below 120 ms.
    public string Stage(int n, int acc, int p95)
    {
        var v = versions[n - 1]; var prod = Production();
        if (Checksum(v.Weights) != v.Sum) return $"v{n} refused: checksum mismatch";
        if (p95 > 120) return $"v{n} blocked: p95 {p95} ms is over 120 ms";
        if (prod != null && acc < prod.Acc - 5) return $"v{n} blocked: accuracy {acc} is below production";
        v.Acc = acc; v.P95 = p95; v.Stage = "staging";
        return $"v{n} is in staging";
    }

    // Production needs a passed staging gate and an approver who is not the author.
    public string Promote(int n, string approver)
    {
        var v = versions[n - 1];
        if (v.Stage != "staging") return $"v{n} refused: not in staging";
        if (approver == v.Author) return $"v{n} refused: the author cannot approve";
        var prod = Production();
        if (prod != null) prod.Stage = "archived";
        v.Stage = "production";
        return $"v{n} is in production, approved by {approver}";
    }

    public Ver? Production() => versions.FirstOrDefault(v => v.Stage == "production");

    // Rollback is a pointer move to the newest archived version: nothing is rebuilt or copied.
    public string Rollback()
    {
        var prev = Enumerable.Reverse(versions).First(v => v.Stage == "archived");
        Production()!.Stage = "rolled-back"; prev.Stage = "production";
        return $"rolled back to v{prev.N}";
    }
}
