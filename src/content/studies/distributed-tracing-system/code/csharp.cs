// Trace context and a tail sampler in C#:
// spans carry a W3C traceparent, arrive out of order, and a sampler buffers each trace for a wait before deciding to keep or drop it.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

static string FormatTraceparent(string traceId, string spanId, bool sampled) => $"00-{traceId}-{spanId}-{(sampled ? "01" : "00")}";

static (string TraceId, string SpanId, bool Sampled)? ParseTraceparent(string header)
{
    var m = Regex.Match(header, @"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$");
    if (!m.Success || m.Groups[1].Value.All(c => c == '0') || m.Groups[2].Value.All(c => c == '0')) return null; // all-zero ids are invalid
    return (m.Groups[1].Value, m.Groups[2].Value, (Convert.ToInt32(m.Groups[3].Value, 16) & 1) == 1);
}

const ulong Seed = 77;
const int Traces = 400;
const int TraceGapMs = 10; // a trace starts about every 10 ms
const int IdWords = 4; // 32-bit words in a 128-bit trace id
const int MinSpans = 3; // spans per trace: 3..7
const int SpanSpread = 5;
const int FailedPct = 4; // traces that fail
const int BadPct = 10; // traces that fail or are slow
const int FailedMinMs = 30; // root span duration of a failed trace: 30..229 ms
const int FailedSpreadMs = 200;
const int SlowMinMs = 800; // of a slow trace: 800..1999 ms
const int SlowSpreadMs = 1200;
const int FastMinMs = 20; // of an ordinary trace: 20..99 ms
const int FastSpreadMs = 80;
const int AsyncPct = 10; // child spans that run async, ending 1..4 s after the root
const int AsyncMinMs = 1000;
const int AsyncSpreadMs = 3000;
const int ExportMinMs = 5; // export delay before a span reaches the collector: 5..124 ms
const int ExportSpreadMs = 120;
ulong seed = Seed;
ulong NextU32() { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return seed; }
int Next(int n) => (int)((NextU32() / 65536UL) % (ulong)n);

// 400 traces. About 4% fail and 6% are slow; 10% have an async span that ends long after the root span.
var traces = new List<Trace>();
var events = new List<Ev>();
for (int i = 0; i < Traces; i++)
{
    int start = i * TraceGapMs + Next(TraceGapMs);
    string traceId = string.Concat(Enumerable.Range(0, IdWords).Select(_ => NextU32().ToString("x8")));
    int kind = Next(100), n = MinSpans + Next(SpanSpread);
    int rootDur = kind < FailedPct ? FailedMinMs + Next(FailedSpreadMs) : kind < BadPct ? SlowMinMs + Next(SlowSpreadMs) : FastMinMs + Next(FastSpreadMs);
    int errAt = kind < FailedPct ? 1 + Next(n - 1) : -1;
    traces.Add(new Trace(traceId, n, kind < BadPct));
    for (int k = 0; k < n; k++)
    {
        int off = 0, dur = rootDur;
        if (k > 0) { off = Next(rootDur / 2 + 1); dur = 1 + Next(Math.Max(1, rootDur - off)); }
        if (k > 0 && Next(100) < AsyncPct) off += AsyncMinMs + Next(AsyncSpreadMs); // async span, ends after the root
        int arrival = start + off + dur + ExportMinMs + Next(ExportSpreadMs);
        events.Add(new Ev(arrival, traceId, k == 0, dur, k == errAt));
    }
}
events = events.OrderBy(e => e.Arrival).ToList(); // stable sort

var rootCtx = ParseTraceparent(FormatTraceparent("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", true))!.Value;
bool invalid = ParseTraceparent("00-" + new string('0', 32) + "-00f067aa0ba902b7-01") == null;
Console.WriteLine($"traceparent round trip: trace {rootCtx.TraceId[..8]}, sampled {Lower(rootCtx.Sampled)}, invalid rejected {Lower(invalid)}");

var bad = traces.Where(t => t.Bad).ToList();
Console.WriteLine($"{traces.Count} traces, {events.Count} spans, {bad.Count} slow or failed");
var results = new Dictionary<int, (int BadKept, int Incomplete, int Peak)>();
int[] waits = { 100, 1000, 10000 }; // ms a trace stays open before the keep decision
foreach (int wait in waits)
{
    var s = new TailSampler(wait);
    foreach (var e in events) s.Add(e);
    s.Finish();
    int badKept = bad.Count(t => s.Kept.ContainsKey(t.Id));
    int incomplete = traces.Count(t => s.Kept.TryGetValue(t.Id, out var count) && count < t.N);
    results[wait] = (badKept, incomplete, s.Peak);
    Console.WriteLine($"wait {wait} ms: kept {s.Kept.Count}, bad kept {badKept}/{bad.Count} ({100 * badKept / bad.Count}%), incomplete {incomplete}, late spans dropped {s.Late}, peak buffered {s.Peak}");
}
var (a, b, c) = (results[waits[0]], results[waits[1]], results[waits[2]]);
bool ok = c.BadKept == bad.Count && c.Incomplete == 0 && a.BadKept < b.BadKept && b.BadKept <= c.BadKept && a.Peak < b.Peak && b.Peak < c.Peak && rootCtx.Sampled;
Console.WriteLine($"a longer wait keeps more bad traces and more of each trace, and buffers more: {Lower(ok)}");
if (!ok) Environment.Exit(1);

static string Lower(bool v) => v ? "true" : "false";

record Trace(string Id, int N, bool Bad);
record Ev(int Arrival, string TraceId, bool Root, int Dur, bool Err);

class Open { public string Id = ""; public long Deadline; public List<Ev> Spans = new(); }

class TailSampler(int wait)
{
    const int SlowThresholdMs = 500; // a root span this long marks a slow trace
    const int BaselinePct = 2; // ordinary traces kept anyway
    readonly List<Open> open = new(); // in order of first arrival, so oldest first
    readonly HashSet<string> decided = new();
    public Dictionary<string, int> Kept = new();
    public int Late, Peak;

    void Decide(Open t)
    {
        open.Remove(t);
        bool slow = t.Spans.Any(s => s.Root && s.Dur >= SlowThresholdMs), error = t.Spans.Any(s => s.Err);
        bool baseline = long.Parse(t.Id[..8], NumberStyles.HexNumber) % 100 < BaselinePct; // keep 2% of ordinary traces
        decided.Add(t.Id);
        if (slow || error || baseline) Kept[t.Id] = t.Spans.Count;
    }

    void Flush(long now) { foreach (var t in open.ToList()) if (t.Deadline <= now) Decide(t); }

    public void Add(Ev e)
    {
        Flush(e.Arrival);
        if (decided.Contains(e.TraceId)) { Late++; return; } // too late: this span is dropped
        var t = open.FirstOrDefault(x => x.Id == e.TraceId);
        if (t == null) { t = new Open { Id = e.TraceId, Deadline = e.Arrival + wait }; open.Add(t); }
        t.Spans.Add(e);
        Peak = Math.Max(Peak, open.Count);
    }

    public void Finish() => Flush(long.MaxValue);
}
