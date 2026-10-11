// Failure detection from heartbeat arrivals only: a fixed timeout vs a phi accrual detector.
// Integer milliseconds everywhere; the only floats are phi values, formatted explicitly.
using System;
using System.Collections.Generic;
using System.Linq;

const int CrashBeat = 140;   // the sender dies after beat 139 (t = 139 s)
const int EndMs = 160000;    // the monitor stops watching here
const int TickMs = 100;      // the monitor checks every 100 ms

// One heartbeat per second. Delay = 20 ms + jitter, with a 5% chance of a 0.4-2.4 s spike.
// Beats 60-64 are never sent (a GC pause that silences the sender for about 6 s); beats 100-103 are lost with 70% probability.
static List<long> MakeTrace(uint seed, int jitter, int spikePerMille)
{
    uint s = unchecked(seed * 7919u + 13u);   // 32-bit linear congruential generator, same in every language
    Func<int> next = () => { s = unchecked(s * 1664525u + 1013904223u); return (int)(s >> 16); };
    var arrivals = new List<long>();
    for (int k = 0; k < CrashBeat; k++)
    {
        int sum = next() % 1000; sum += next() % 1000; sum += next() % 1000; sum += next() % 1000;
        int spike = next() % 1000, extra = next() % 2000, loss = next() % 1000;
        if (k >= 60 && k < 65) continue;
        if (k >= 100 && k < 104 && loss < 700) continue;
        long delay = 20 + (long)jitter * sum / 1000;
        if (spike < spikePerMille) delay += 400 + extra;
        arrivals.Add(1000L * k + delay);
    }
    arrivals.Sort();
    return arrivals;
}

static string Fmt2(double x)
{
    long n = (long)Math.Floor(x * 100 + 0.5);
    return $"{n / 100}.{(n % 100):D2}";
}

var trace = MakeTrace(1, 50, 50);
Console.WriteLine($"trace: {trace.Count} heartbeats, last at {trace[^1]} ms");
var results = new Dictionary<string, (List<long> fa, long detect)>();
PhiAccrual phi8 = null!;
var detectors = new (string name, IDetector det)[] {
    ("fixed 2000 ms", new FixedTimeout(2000)), ("fixed 5000 ms", new FixedTimeout(5000)), ("fixed 10000 ms", new FixedTimeout(10000)),
    ("phi >= 4", new PhiAccrual(4)), ("phi >= 8", phi8 = new PhiAccrual(8)), ("phi >= 12", new PhiAccrual(12)) };
foreach (var (name, det) in detectors)
{
    var r = Evaluate(trace, det);
    results[name] = r;
    Console.WriteLine($"{name.PadRight(14)} false alarms {r.fa.Count} [{string.Join(" ", r.fa)}]  crash detected after {r.detect} ms");
}
Console.WriteLine("phi at the end, after 1000/2000/3000/5000 ms of silence: " + string.Join(" / ", new[] { 1000, 2000, 3000, 5000 }.Select(s => Fmt2(phi8.Phi(s)))));

var f2 = results["fixed 2000 ms"]; var f10 = results["fixed 10000 ms"]; var p8 = results["phi >= 8"];
bool ok = p8.detect > 0 && f2.detect > 0 && f10.detect > 0      // every detector catches the crash
    && p8.fa.Count <= f2.fa.Count                                // phi is no worse than a 2 s timeout on the jittery trace
    && f10.fa.Count == 0 && f10.detect > p8.detect;              // the long timeout buys accuracy with detection time
return ok ? 0 : 1;

// A suspicion that a later heartbeat clears is a false alarm; the one still standing at the end is the detection.
static (List<long> fa, long detect) Evaluate(List<long> arrivals, IDetector detector)
{
    int i = 0; long last = -1, since = 0; bool suspected = false;
    var falseAlarms = new List<long>();
    for (long t = 0; t <= EndMs; t += TickMs)
    {
        while (i < arrivals.Count && arrivals[i] <= t)
        {
            if (last >= 0) detector.Arrive(arrivals[i] - last);
            last = arrivals[i++];
            if (suspected) { falseAlarms.Add(since); suspected = false; }
        }
        if (last >= 0 && !suspected && detector.Suspect(t - last)) { suspected = true; since = t; }
    }
    return (falseAlarms, suspected ? since - last : -1);
}

interface IDetector { void Arrive(long intervalMs); bool Suspect(long silenceMs); }

class FixedTimeout : IDetector
{
    readonly long timeoutMs;
    public FixedTimeout(long timeoutMs) { this.timeoutMs = timeoutMs; }
    public void Arrive(long intervalMs) { }
    public bool Suspect(long silenceMs) => silenceMs > timeoutMs;
}

class PhiAccrual : IDetector   // Akka-style: logistic approximation of the normal tail
{
    readonly int threshold, windowSize = 100; readonly double minStdMs = 100;
    readonly Queue<long> window = new Queue<long>(new long[] { 750, 1250 });  // seed guess: 1 s +- 250 ms
    long sum = 2000, sumSq = 750L * 750 + 1250L * 1250;
    public PhiAccrual(int threshold) { this.threshold = threshold; }
    public void Arrive(long intervalMs)
    {
        window.Enqueue(intervalMs); sum += intervalMs; sumSq += intervalMs * intervalMs;
        if (window.Count > windowSize) { long old = window.Dequeue(); sum -= old; sumSq -= old * old; }
    }
    public double Phi(long silenceMs)
    {
        int n = window.Count; double mean = (double)sum / n;
        double std = Math.Max(Math.Sqrt(Math.Max(0.0, (double)sumSq / n - mean * mean)), minStdMs);
        double y = (silenceMs - mean) / std;
        double e = Math.Exp(-y * (1.5976 + 0.070566 * y * y));
        double p = silenceMs > mean ? e / (1 + e) : 1 - 1 / (1 + e);  // P(heartbeat arrives later than now)
        return p < 1e-16 ? 16.0 : -Math.Log10(p);
    }
    public bool Suspect(long silenceMs) => Phi(silenceMs) >= threshold;
}
