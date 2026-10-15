// A live stream through a CDN, in C#:
// a rendition ladder, segment requests through edge and shield caches, glass-to-glass latency and an ingest failover.
using System;
using System.Collections.Generic;
using System.Linq;

var ladder = new (string Name, int Kbps)[] { ("1080p", 6000), ("720p", 3000), ("480p", 1200), ("240p", 400) };
int[] share = { 20, 40, 30, 10 }; // percent of viewers who settle on each rendition
const int SegMs = 2000, Segs = 30, Edges = 8, ViewerCount = 2000;

uint seed = 7;
int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

var viewers = new List<(int Rendition, int Edge)>();
for (int i = 0; i < ViewerCount; i++)
{
    int pick = Rnd(100), r = 0;
    while (pick >= share[r]) { pick -= share[r]; r++; }
    viewers.Add((r, Rnd(Edges)));
}

// Every viewer asks its edge for every segment. A miss goes to the shield (if there is one) and then to the origin.
// Requests for a key that is already cached, or already on its way, are coalesced and do not go further.
(int Origin, long Kbit) Deliver(bool useShield)
{
    var edgeSeen = new HashSet<string>();
    var shieldSeen = new HashSet<string>();
    int origin = 0; long kbit = 0;
    for (int seg = 0; seg < Segs; seg++)
        foreach (var v in viewers)
        {
            if (!edgeSeen.Add($"{v.Edge}:{v.Rendition}:{seg}")) continue;
            if (useShield && !shieldSeen.Add($"{v.Rendition}:{seg}")) continue;
            origin++;
            kbit += ladder[v.Rendition].Kbps * (SegMs / 1000);
        }
    return (origin, kbit);
}

// Delay from camera to screen: ingest, transcode, wait for a whole unit (segment or part), the player's hold-back, delivery.
int GlassToGlass(int unitMs, int held) => 300 + 500 + unitMs + held * unitMs + 400;

// Milliseconds with no segments: the standby resumes on the next segment boundary after it has started.
int Failover(int failAt, int detectMs, int startMs)
{
    int lastGood = failAt / SegMs * SegMs;
    int resume = (failAt + detectMs + startMs + SegMs - 1) / SegMs * SegMs;
    return resume - lastGood;
}

string Stalls(int gap, int held) => gap > held * SegMs ? "stalls" : "plays on";

Console.WriteLine($"ladder: {string.Join(" ", ladder.Select(l => $"{l.Name}={l.Kbps}"))} total {ladder.Sum(l => l.Kbps)} kbit/s");
var plain = Deliver(false);
var shielded = Deliver(true);
Console.WriteLine($"requests to origin over {Segs} segments: {plain.Origin} without shield, {shielded.Origin} with shield");
Console.WriteLine($"origin egress: {plain.Kbit} kbit without shield, {shielded.Kbit} with shield");
foreach (var (name, unit, held) in new[] { ("6 s segments, hold 3", 6000, 3), ("2 s segments, hold 3", 2000, 3), ("2 s segments, hold 2", 2000, 2), ("0.5 s parts, hold 3", 500, 3) })
    Console.WriteLine($"{name}: {GlassToGlass(unit, held)} ms, {1000000 / unit} requests/s per 1000 viewers");
int cold = Failover(25300, 2000, 3000), warm = Failover(25300, 1000, 0);
Console.WriteLine($"failover gap: cold standby {cold} ms, warm standby {warm} ms, dual active 0 ms");
Console.WriteLine($"viewer holding 1 segment: cold {Stalls(cold, 1)}, warm {Stalls(warm, 1)}; holding 3: cold {Stalls(cold, 3)}, warm {Stalls(warm, 3)}");

if (shielded.Origin != ladder.Length * Segs) return 1;   // one fetch per rendition and segment
if (plain.Origin <= shielded.Origin * 4) return 2;        // without a shield every edge fetches on its own
if (GlassToGlass(500, 3) >= GlassToGlass(2000, 2)) return 3;
if (warm >= cold) return 4;
return 0;
