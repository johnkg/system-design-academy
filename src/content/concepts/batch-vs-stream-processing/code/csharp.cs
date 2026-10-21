// Batch vs stream on the same late-arriving events: count orders per 10-minute window of EVENT time.
// The stream answers fast from a watermark and drops what comes too late; the batch recomputes the log on a schedule.
using System;
using System.Collections.Generic;
using System.Linq;

const int WIN = 600, NWIN = 8, REPORT = 6, SPAN = 4800; // window (s), windows, windows reported, event-time span (s)
const int LATE_MIN = 20; // a late event arrives at least this many seconds after it happened
const int ON_TIME_JITTER = 4; // an on-time event arrives 0..3 s after it happened
const int SECONDS_PER_MINUTE = 60;
const int EVENT_COUNT = 800, LATE_PCT = 10, LATE_MAX = 300; const uint SEED = 7;
const int SHORT_WAIT = 30; // seconds the first stream waits past a window's end

List<Ev> Generate(int n, int latePct, int lateMax, uint seed)
{
    uint s = seed;
    // 32-bit LCG (Numerical Recipes constants)
    uint Next() { unchecked { s = s * 1664525u + 1013904223u; } return s >> 8; }
    var events = new List<Ev>();
    for (int i = 0; i < n; i++)
    {
        int t = (int)(Next() % SPAN); // when it happened (event time, seconds)
        int r = (int)(Next() % 100);
        int delay = r < latePct ? LATE_MIN + (int)(Next() % (uint)(lateMax - LATE_MIN + 1)) : (int)(Next() % ON_TIME_JITTER);
        events.Add(new Ev(i, t, t + delay)); // A = when it reaches us (processing time)
    }
    return events;
}

int[] TrueCounts(List<Ev> events)
{
    var c = new int[REPORT];
    foreach (var e in events) { int w = e.T / WIN; if (w < REPORT) c[w]++; }
    return c;
}

// Stream: one pass in arrival order. A window is emitted once watermark = newest event time - wait passes its end.
Res RunStream(List<Ev> events, int wait)
{
    var order = events.OrderBy(e => e.A).ThenBy(e => e.T).ThenBy(e => e.I).ToList();
    var count = new int[NWIN]; var emitted = new bool[NWIN]; var at = new int[NWIN]; var seen = new int[NWIN];
    int dropped = 0, maxT = -1, last = 0;
    foreach (var e in order)
    {
        int w = e.T / WIN;
        last = e.A;
        if (emitted[w]) { if (w < REPORT) dropped++; } else count[w]++; // too late: the window is already out
        if (e.T > maxT) maxT = e.T;
        for (int x = 0; x < NWIN; x++)
            if (!emitted[x] && (x + 1) * WIN <= maxT - wait) { emitted[x] = true; at[x] = e.A; seen[x] = count[x]; }
    }
    for (int x = 0; x < NWIN; x++) if (!emitted[x]) { emitted[x] = true; at[x] = last; seen[x] = count[x]; }
    var truth = TrueCounts(events);
    var rows = Enumerable.Range(0, REPORT).Select(w => new Row(w, truth[w], seen[w], at[w], seen[w] == truth[w] ? at[w] : -1)).ToList();
    return new Res(rows, events.Count, dropped);
}

// Batch: every `minutes` re-read the whole log. A window is exact at the first run that has seen all of its events.
Res RunBatch(List<Ev> events, int minutes)
{
    int step = minutes * SECONDS_PER_MINUTE; var truth = TrueCounts(events);
    int CountAt(int w, int run) => events.Count(e => e.A <= run && e.T / WIN == w);
    var rows = new List<Row>(); int lastRun = 0;
    for (int w = 0; w < REPORT; w++)
    {
        int run = (((w + 1) * WIN + step - 1) / step) * step;
        int firstAt = run, first = CountAt(w, run);
        while (CountAt(w, run) != truth[w]) run += step;
        rows.Add(new Row(w, truth[w], first, firstAt, run));
        lastRun = Math.Max(lastRun, run);
    }
    int read = 0;
    for (int run = step; run <= lastRun; run += step) read += events.Count(e => e.A <= run);
    return new Res(rows, read, 0);
}

int Mean(IEnumerable<int> xs) { var l = xs.ToList(); return (2 * l.Sum() + l.Count) / (2 * l.Count); } // floor(x + 0.5)

int Report(string label, Res res)
{
    int missing = res.Rows.Sum(r => r.Truth - r.First);
    int total = res.Rows.Sum(r => r.Truth);
    int delay = Mean(res.Rows.Select(r => r.FirstAt - (r.W + 1) * WIN));
    Console.WriteLine($"{label}: first answer +{delay}s, missing {missing}/{total}, events read {res.Read}");
    return missing;
}

var events = Generate(EVENT_COUNT, LATE_PCT, LATE_MAX, SEED);
var stream30 = RunStream(events, SHORT_WAIT);
Console.WriteLine("window  true  first  answered_at");
foreach (var r in stream30.Rows) Console.WriteLine($"{r.W}       {r.Truth}   {r.First}    +{r.FirstAt - (r.W + 1) * WIN}s");

int missStream30 = Report("stream wait 30s ", stream30);
int missStream300 = Report("stream wait 300s", RunStream(events, LATE_MAX));
var batch15 = RunBatch(events, 15);
var batch60 = RunBatch(events, 60);
Report("batch every 15m", batch15);
Report("batch every 60m", batch60);

// Invariants: dropped events are exactly the missing ones, a long wait loses nothing, and every batch ends exact.
if (missStream30 != stream30.Dropped) throw new Exception("dropped count mismatch");
if (missStream300 != 0) throw new Exception("a wait as long as the lateness must lose nothing");
foreach (var b in new[] { batch15, batch60 }) if (b.Rows.Any(r => r.ExactAt < 0)) throw new Exception("batch must end exact");
Console.WriteLine("invariants ok");

record Ev(int I, int T, int A);
record Row(int W, int Truth, int First, int FirstAt, int ExactAt);
record Res(List<Row> Rows, int Read, int Dropped);
