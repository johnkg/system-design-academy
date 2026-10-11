// Tumbling event-time windows with a bounded-out-of-orderness watermark.
// Events arrive in processing order; each carries the event time (seconds) when the click happened.
using System;
using System.Collections.Generic;
using System.Linq;

const int Window = 10;
int[] events = { 1, 3, 12, 8, 5, 14, 22, 11, 25, 9, 31, 18, 35, 27, 41, 33 }; // event times, in arrival order

// Returns the fired windows (start -> count emitted when the watermark passed its end) and the late events.
(SortedDictionary<int, int> fired, List<int> late) Run(int delay, bool verbose)
{
    var openWindows = new SortedDictionary<int, int>(); // window start -> count, still waiting for the watermark
    var fired = new SortedDictionary<int, int>();
    var late = new List<int>();
    int? maxTime = null;
    int? watermark = null; // null means "nothing seen yet"

    void FireReady(string label)
    {
        foreach (var start in openWindows.Keys.ToList())
        {
            if (start + Window <= watermark)
            {
                fired[start] = openWindows[start];
                openWindows.Remove(start);
                if (verbose) Console.WriteLine($"  {label} wm={watermark} fire [{start},{start + Window}) count={fired[start]}");
            }
        }
    }

    foreach (var t in events)
    {
        int start = t / Window * Window;
        if (watermark != null && start + Window <= watermark)
        {
            late.Add(t); // its window already fired: the result cannot be updated
            if (verbose) Console.WriteLine($"  t={t} wm={watermark} LATE, dropped");
            continue;
        }
        openWindows[start] = openWindows.GetValueOrDefault(start) + 1;
        maxTime = maxTime == null ? t : Math.Max(maxTime.Value, t);
        watermark = maxTime - delay; // the watermark never moves backwards because maxTime does not
        FireReady($"t={t}");
    }
    // End of input: the watermark jumps to infinity and flushes everything left.
    watermark = 1000000000;
    FireReady("end");
    return (fired, late);
}

var truth = new Dictionary<int, int>();
foreach (var t in events)
{
    int s = t / Window * Window;
    truth[s] = truth.GetValueOrDefault(s) + 1;
}

foreach (var delay in new[] { 0, 5, 20 })
{
    Console.WriteLine($"watermark delay {delay}s");
    var (fired, late) = Run(delay, delay == 5);
    int error = truth.Sum(kv => Math.Abs(kv.Value - fired.GetValueOrDefault(kv.Key)));
    int counted = fired.Values.Sum();
    Console.WriteLine($"  windows={fired.Count} counted={counted} late={late.Count} error={error}");
    if (counted + late.Count != events.Length) throw new Exception("every event is counted or late");
    if (error != late.Count) throw new Exception("the only error is the dropped late events");
    if (delay == 20 && late.Count != 0) throw new Exception("a delay above the worst disorder (16s) drops nothing");
}
