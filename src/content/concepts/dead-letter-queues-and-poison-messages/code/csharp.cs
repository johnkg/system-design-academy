// Dead-letter queues: one ordered consumer over a seeded message list, four failure policies.
// Time is counted in ticks (one processing attempt per tick), so the output is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

const int Total = 40, Limit = 3, Horizon = 400;

string[] MakeKinds()
{
    long x = 7;
    var kinds = new string[Total];
    for (int i = 0; i < Total; i++)
    {
        x = (x * 48271) % 2147483647; // MINSTD, integer only
        long r = x % 100;
        kinds[i] = r < 8 ? "poison" : r < 25 ? "transient" : "ok";
    }
    return kinds;
}

// poison always fails; transient fails on its first attempt only
bool AttemptOk(string kind, int n) => kind == "ok" || (kind == "transient" && n > 1);

(int delivered, int dropped, int parked, int stuck, int attempts, int inversions) Run(string policy, string[] kinds)
{
    var queue = Enumerable.Range(0, Total).ToList();
    var delayed = new List<(int due, int id)>();
    var tries = new int[Total];
    var delivered = new List<int>();
    int dropped = 0, parked = 0, attempts = 0;
    for (int tick = 0; tick < Horizon; tick++)
    {
        var due = delayed.Where(d => d.due <= tick).ToList();
        delayed = delayed.Where(d => d.due > tick).ToList();
        queue.AddRange(due.Select(d => d.id)); // retry queue feeds the back of the main queue
        if (queue.Count == 0) continue;
        int mid = queue[0];
        tries[mid]++;
        attempts++;
        if (AttemptOk(kinds[mid], tries[mid]))
        {
            queue.RemoveAt(0);
            delivered.Add(mid);
        }
        else if (policy == "forever") { /* stays at the head: redelivered in place, blocking the queue */ }
        else if (policy == "backoff" && tries[mid] < Limit)
        {
            queue.RemoveAt(0);
            delayed.Add((tick + (1 << tries[mid]), mid)); // wait 2, 4, ... ticks
        }
        else if (policy != "backoff" && tries[mid] < Limit) { /* immediate retry in place */ }
        else
        {
            queue.RemoveAt(0);
            if (policy == "drop") dropped++; else parked++;
        }
    }
    int stuck = queue.Count + delayed.Count;
    var pos = new Dictionary<int, int>();
    for (int i = 0; i < delivered.Count; i++) pos[delivered[i]] = i;
    int inversions = 0;
    foreach (var a in delivered) foreach (var b in delivered) if (a < b && pos[a] > pos[b]) inversions++;
    return (delivered.Count, dropped, parked, stuck, attempts, inversions);
}

var kinds = MakeKinds();
int Count(string k) => kinds.Count(v => v == k);
Console.WriteLine($"messages={Total} poison={Count("poison")} transient={Count("transient")} limit={Limit}");
var res = new Dictionary<string, (int delivered, int dropped, int parked, int stuck, int attempts, int inversions)>();
foreach (var p in new[] { "forever", "drop", "dlq", "backoff" })
{
    var r = res[p] = Run(p, kinds);
    Console.WriteLine($"{p,-8} delivered={r.delivered} dropped={r.dropped} parked={r.parked} stuck={r.stuck} attempts={r.attempts} inversions={r.inversions}");
}

void Need(bool c, string m) { if (!c) { Console.Error.WriteLine("FAILED: " + m); Environment.Exit(1); } }
int poison = Count("poison");
Need(res["forever"].stuck > 0 && res["forever"].delivered < Total - poison, "forever blocks");
foreach (var p in new[] { "dlq", "backoff" })
{
    Need(res[p].stuck == 0 && res[p].dropped == 0, p + " stuck or dropped");
    Need(res[p].delivered + res[p].parked == Total, p + " lost a message");
    Need(res[p].parked == poison, p + " parked a healthy message");
}
Need(res["drop"].dropped == poison, "drop loses poison");
Need(res["dlq"].inversions == 0 && res["backoff"].inversions > 0, "ordering trade-off");
Console.WriteLine("ok: forever blocks, drop loses, dlq and backoff lose nothing");
