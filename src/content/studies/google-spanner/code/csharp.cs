// A miniature of TrueTime and commit wait from Google's Spanner paper (OSDI 2012), in C# (a teaching model, not Google's code).
// Each server's clock may be off by a few milliseconds, but the clock API returns an interval that is guaranteed to hold the true time.
// A write takes the latest end of that interval as its timestamp and, with commit wait, tells the client "done" only once that
// timestamp is certainly in the past. Without the wait, a write that starts after another one has finished can get an earlier timestamp.
// All times are whole milliseconds and everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

const int Epsilon = 4; // uncertainty in ms; the paper says it is about 4 ms most of the time and generally under 10 ms
var skew = new Dictionary<string, int> { ["X"] = 3, ["Y"] = -3 }; // how far each server's local clock is from true time (always within Epsilon)

// TT.now(): an interval that is guaranteed to contain the true time
(int Earliest, int Latest) Now(string server, int trueTime)
{
    int local = trueTime + skew[server];
    return (local - Epsilon, local + Epsilon);
}

(int Ts, int AckTrue) Write(List<(int Ts, string Value)> versions, string server, int startTrue, string value, bool wait)
{
    int ts = Now(server, startTrue).Latest; // commit timestamp: no earlier than TT.now().Latest
    int ack = startTrue;
    if (wait) while (!(Now(server, ack).Earliest > ts)) ack++; // commit wait: until TT.after(ts) is true
    versions.Add((ts, value));
    return (ts, ack);
}

List<(int Ts, string Value)> Scenario(bool wait)
{
    Console.WriteLine($"--- commit wait {(wait ? "on" : "off")}, uncertainty +/-{Epsilon} ms");
    var versions = new List<(int Ts, string Value)>();
    var t1 = Write(versions, "X", 100, "x=1", wait);
    Console.WriteLine($"T1 on server X starts at 100, gets timestamp {t1.Ts}, client told \"done\" at {t1.AckTrue} (waited {t1.AckTrue - 100} ms)");
    var t2 = Write(versions, "Y", t1.AckTrue + 1, "x=2", wait);
    Console.WriteLine($"T2 on server Y starts at {t1.AckTrue + 1}, after T1 finished, and gets timestamp {t2.Ts}");
    Console.WriteLine(t2.Ts > t1.Ts
        ? "timestamps follow real time: external consistency holds"
        : "T2 started after T1 finished but has the EARLIER timestamp: external consistency broken");
    return versions;
}

void SnapshotRead(List<(int Ts, string Value)> versions, int at) // newest version at or before the timestamp, no locks
{
    var seen = versions.Where(v => v.Ts <= at).OrderByDescending(v => v.Ts).Select(v => v.Value).FirstOrDefault();
    Console.WriteLine($"snapshot read at {at}: {seen ?? "nothing yet"}");
}

Scenario(false);
var kept = Scenario(true);
Console.WriteLine("--- snapshot reads of the second run need no locks");
foreach (var at in new[] { 106, 107, 110, 111 }) SnapshotRead(kept, at);
