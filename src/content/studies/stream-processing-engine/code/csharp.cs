// A tiny stream engine in C#: keyed state, tumbling event-time windows, watermarks,
// checkpoints, and recovery by restoring state and replaying the log. Integers only, so it is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

const int EVERY = 50; // checkpoint interval in events (the window length 10 and watermark lag 4 are constants of Job)

long seed = 7;
int Rnd(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

var events = new List<(int Key, int Time, int Value)>();
for (int i = 0; i < 2000; i++) // arrive out of order
{
    int key = Rnd(5);
    int time = Math.Max(0, (i >> 2) - Rnd(8));
    int value = 1 + Rnd(9);
    events.Add((key, time, value));
}

(Job job, int replayed) Run(int[] crashes, bool transactionalSink)
{
    var job = new Job(events);
    var snap = job.Snapshot();
    int next = 0, replayed = 0;
    while (job.Offset < events.Count)
    {
        if (next < crashes.Length && job.Offset == crashes[next]) { next++; replayed += job.Offset - snap.Offset; job.Restore(snap, transactionalSink); continue; }
        job.Step();
        if (job.Offset % EVERY == 0) snap = job.Snapshot();
    }
    job.Fire(long.MaxValue); // the stream ended: flush what is left
    return (job, replayed);
}

long Checksum(List<(long Id, long Sum)> o) { long h = 0; foreach (var (id, sum) in o) h = (h * 131 + id * 1000 + sum) % 1000003; return h; }
long TotalOf(Job j) => j.Out.Sum(r => r.Sum) + j.LateSum;

long total = events.Sum(e => (long)e.Value);
int[] crashList = { 130, 410, 777, 1499 };

var reference = Run(new int[0], true).job;
Console.WriteLine($"no crash: {reference.Out.Count} windows, late dropped {reference.Late}, checksum {Checksum(reference.Out)}");
var (exact, replayed) = Run(crashList, true);
bool same = exact.Out.SequenceEqual(reference.Out);
Console.WriteLine($"4 crashes, transactional sink: replayed {replayed} events, identical output: {(same ? "true" : "false")}");
var naive = Run(crashList, false).job;
Console.WriteLine($"4 crashes, plain sink: {naive.Out.Count} rows, {naive.Out.Count - reference.Out.Count} duplicates");
Console.WriteLine("first rows: " + string.Join("; ", reference.Out.Take(3).Select(r => $"key {r.Id % 10} @{r.Id / 10} = {r.Sum}")));

if (!same || TotalOf(reference) != total || TotalOf(exact) != total || naive.Out.Count <= reference.Out.Count) Environment.Exit(1);

record Snap(int Offset, int MaxTime, Dictionary<long, long> Windows, int OutLen, int Late, long LateSum);

class Job
{
    const int WINDOW = 10, DELAY = 4;
    readonly List<(int Key, int Time, int Value)> events;
    public int Offset, MaxTime = -1, Late;
    public long LateSum;
    public Dictionary<long, long> Windows = new();
    public List<(long Id, long Sum)> Out = new();
    public Job(List<(int Key, int Time, int Value)> e) { events = e; }

    public void Fire(long limit) // emit every window that ends at or before the watermark, oldest first
    {
        foreach (var id in Windows.Keys.Where(i => i / 10 + WINDOW <= limit).OrderBy(i => i).ToList())
        {
            Out.Add((id, Windows[id]));
            Windows.Remove(id);
        }
    }

    public void Step()
    {
        var e = events[Offset++];
        int start = e.Time - (e.Time % WINDOW);
        long id = (long)start * 10 + e.Key; // the state is keyed by (key, window)
        MaxTime = Math.Max(MaxTime, e.Time);
        int watermark = MaxTime - DELAY;
        if (start + WINDOW <= watermark) { Late++; LateSum += e.Value; } // its window has already fired
        else Windows[id] = (Windows.TryGetValue(id, out var v) ? v : 0) + e.Value;
        Fire(watermark);
    }

    public Snap Snapshot() => new(Offset, MaxTime, new Dictionary<long, long>(Windows), Out.Count, Late, LateSum);

    public void Restore(Snap s, bool transactionalSink)
    {
        Offset = s.Offset; MaxTime = s.MaxTime; Windows = new Dictionary<long, long>(s.Windows); Late = s.Late; LateSum = s.LateSum;
        if (transactionalSink) Out.RemoveRange(s.OutLen, Out.Count - s.OutLen); // uncommitted output is aborted
    }
}
