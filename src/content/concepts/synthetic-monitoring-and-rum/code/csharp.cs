// Synthetic probes with an N-of-M rule, and the p75 of a RUM sample, on one seeded day of 1440 minutes.
using System;
using System.Collections.Generic;
using System.Linq;

const int Day = 1440, FaultStart = 180, FaultEnd = 360, Brazil = 4;
uint state = 9;

int Rand(int n) // small integer LCG so every language prints the same numbers
{
    state = unchecked(state * 1664525u + 1013904223u);
    return (int)((state >> 16) % (uint)n);
}

// The world is drawn once, in a fixed order, so every probe setting sees the same day.
var blip = new int[5, Day];  // 1 = single-probe network blip (0.4%)
var fails = new int[5, Day]; // 1 = a probe in the faulted region fails (90%)
for (int t = 0; t < Day; t++)
    for (int loc = 0; loc < 5; loc++)
    {
        blip[loc, t] = Rand(1000) < 4 ? 1 : 0;
        fails[loc, t] = Rand(100) < 90 ? 1 : 0;
    }

(int detect, int falseAlarms, int checks) Synthetic(int interval, int locations, int need)
{
    need = Math.Min(need, locations);
    var latest = new (bool failed, bool real)?[locations]; // each location's latest check
    int detect = -1, falseAlarms = 0, checks = 0;
    bool wasFalse = false;
    for (int t = 0; t < Day; t++)
    {
        bool ran = false;
        for (int k = 0; k < locations; k++)
        {
            int offset = k * interval / locations; // staggered start per location
            if (t >= offset && (t - offset) % interval == 0)
            {
                ran = true; checks++;
                bool real = k == Brazil && t >= FaultStart && t < FaultEnd && fails[k, t] == 1;
                latest[k] = (real || blip[k, t] == 1, real);
            }
        }
        if (!ran) continue;
        var failing = latest.Where(s => s.HasValue && s.Value.failed).ToList();
        bool met = failing.Count >= need;
        bool causedByFault = failing.Any(s => s!.Value.real);
        if (met && causedByFault && detect < 0) detect = t - FaultStart;
        bool isFalse = met && !causedByFault;
        if (isFalse && !wasFalse) falseAlarms++;
        wasFalse = isFalse;
    }
    return (detect, falseAlarms, checks);
}

int P75(IEnumerable<int> values) // nearest rank: the ceil(0.75 * n)-th smallest
{
    var s = values.OrderBy(v => v).ToList();
    return s[(3 * s.Count + 3) / 4 - 1];
}

List<List<int>> RumDay(int samplingPct)
{
    var perMinute = new List<List<int>>();
    for (int t = 0; t < Day; t++)
    {
        bool slow = t >= FaultStart && t < FaultEnd;
        var minute = new List<int>();
        for (int v = 0; v < 40; v++) // 40 Brazil page views per minute
        {
            if (Rand(100) < samplingPct) // the sampling decision
            {
                int lcp = 900 + Rand(800) + Rand(800); // 900..2500 ms, about 1.7 s median
                minute.Add(slow ? lcp * 3 : lcp);
            }
        }
        perMinute.Add(minute);
    }
    return perMinute;
}

int RumDetect(List<List<int>> perMinute) // 15-minute window, at least 20 samples, p75 above 4000 ms
{
    for (int t = 15; t < Day; t++)
    {
        var window = perMinute.Skip(t - 15).Take(15).SelectMany(m => m).ToList();
        if (window.Count >= 20 && P75(window) > 4000) return t - FaultStart;
    }
    return -1;
}

var results = new Dictionary<string, (int detect, int falseAlarms)>();
foreach (var (interval, locations, need) in new[] { (5, 3, 1), (5, 5, 1), (5, 5, 2), (1, 5, 1), (15, 5, 1), (1, 5, 3) })
{
    var (d, f, c) = Synthetic(interval, locations, need);
    Console.WriteLine($"every {interval,2} min, {locations} locations, need {need}: detected after {(d >= 0 ? d.ToString() : "never")}, false alarms {f}, checks {c}");
    results[$"{interval},{locations},{need}"] = (d, f);
}

var days = RumDay(10);
var fault = days.Skip(FaultStart).Take(FaultEnd - FaultStart).SelectMany(m => m).ToList();
var normal = days.Take(FaultStart).SelectMany(m => m).ToList();
long mean = fault.Sum(v => (long)v) / fault.Count;
Console.WriteLine($"RUM at 10%: normal p75 {P75(normal)} ms, outage p75 {P75(fault)} ms, outage mean {mean} ms");
int rum10 = RumDetect(days), rum1 = RumDetect(RumDay(1));
Console.WriteLine($"RUM alert after {rum10} min with 10% sampling, after {rum1} with 1%");

void Check(bool ok, string message)
{
    if (!ok) { Console.Error.WriteLine("assertion failed: " + message); Environment.Exit(1); }
}
var r = results;
Check(r["5,3,1"].detect == -1, "no probe in Brazil: the regional fault is invisible");
Check(r["5,5,1"].detect >= 0 && r["5,5,1"].detect < 5, "a Brazil probe, any 1: found within one interval");
Check(r["5,5,2"].detect == -1 || r["5,5,2"].detect > r["5,5,1"].detect, "2 of 5 hides a one-region fault");
Check(r["1,5,3"].detect == -1 && r["1,5,3"].falseAlarms == 0, "3 of 5 never fires on blips or on one region");
Check(r["1,5,1"].falseAlarms > r["5,5,1"].falseAlarms && r["5,5,1"].falseAlarms > r["15,5,1"].falseAlarms, "shorter interval, more false alarms");
Check(P75(normal) < 2500 && 4000 < P75(fault), "p75 moves from good to poor");
Check(rum10 >= 0 && rum10 < 30 && rum1 == -1, "1% sampling is too thin to alert");
Console.WriteLine("ok");
