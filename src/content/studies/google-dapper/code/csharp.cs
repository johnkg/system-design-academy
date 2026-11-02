// A miniature of Dapper, Google's tracing system (Google technical report, 2010), in C# (a teaching model, not Google's code):
// every traced request carries a trace id, span id and parent span id through its RPCs, the sampling decision is made once at the
// root and followed by every callee, each host writes spans to its own local log, a collector gathers the logs out of band, and
// the trace tree is rebuilt from the ids even when some hosts have not been collected yet. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

const int Rate = 4; // trace 1 request in 4 (Dapper's real rates are as low as 1 in 1024)
const int Requests = 20;
var logs = new Dictionary<string, List<Span>> // each host's local span log
{
    ["frontend"] = new(), ["auth"] = new(), ["search"] = new(), ["index"] = new(), ["ads"] = new(),
};

// One request: frontend calls auth and search; search calls index and ads. The times are made up and depend on the trace id.
bool Handle(int traceId)
{
    bool sampled = traceId % Rate == 0; // decided once, at the root
    int next = 1;
    int Add(string host, string name, int? parent, int start, int end)
    {
        int id = traceId * 10 + next++;
        if (sampled) logs[host].Add(new Span(traceId, id, parent, name, host, start, end)); // untraced requests write nothing
        return id;
    }
    int adsTime = 40 + (traceId % 3) * 15;
    int root = Add("frontend", "Frontend.Request", null, 0, 20 + 70 + adsTime);
    Add("auth", "Auth.Check", root, 5, 15);
    int search = Add("search", "Search.Query", root, 20, 20 + 70 + adsTime);
    Add("index", "Index.Lookup", search, 30, 60);
    Add("ads", "Ads.Select", search, 30, 30 + adsTime);
    return sampled;
}

var sampledIds = Enumerable.Range(1, Requests).Where(Handle).ToList();
int written = logs.Values.Sum(l => l.Count);
Console.WriteLine($"{Requests} requests, sampling 1 in {Rate}: traced {string.Join(", ", sampledIds)}");
Console.WriteLine($"spans written: {written} instead of {Requests * 5} if every request were traced");

(List<string> Lines, int Count) Tree(IEnumerable<Span> spans, int traceId) // rebuild the tree from ids alone
{
    var mine = spans.Where(s => s.Trace == traceId).ToList();
    var lines = new List<string>();
    void Walk(int? parent, int depth)
    {
        foreach (var s in mine.Where(x => x.Parent == parent).OrderBy(x => x.Start))
        {
            lines.Add($"{new string(' ', depth * 2)}{s.Name} on {s.Host}: {s.Start}-{s.End} ms ({s.End - s.Start} ms)");
            Walk(s.Id, depth + 1);
        }
    }
    Walk(null, 0);
    return (lines, mine.Count);
}

Console.WriteLine("--- collection is out of band: the daemons have gathered every host except ads");
var partial = logs.Where(p => p.Key != "ads").SelectMany(p => p.Value).ToList();
var (lines1, count1) = Tree(partial, 4);
Console.WriteLine($"trace 4 has {count1} of 5 spans so far");
foreach (var l in lines1) Console.WriteLine($"  {l}");
Console.WriteLine("--- the ads host is collected");
var everything = logs.Values.SelectMany(l => l).ToList();
var (lines2, count2) = Tree(everything, 4);
Console.WriteLine($"trace 4 has {count2} of 5 spans");
foreach (var l in lines2) Console.WriteLine($"  {l}");
var slowest = sampledIds.OrderByDescending(i => everything.First(s => s.Trace == i && s.Parent == null).End).First();
Console.WriteLine($"slowest traced request: trace {slowest}, {Tree(everything, slowest).Lines[0]}");

record Span(int Trace, int Id, int? Parent, string Name, string Host, int Start, int End);
