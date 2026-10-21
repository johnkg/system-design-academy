// A tiny GFS-style cluster in C#: a master with a chunk map, rack-aware placement,
// heartbeats that detect dead servers, prioritised re-replication, and checksum scrubbing.
using System;
using System.Collections.Generic;
using System.Linq;

const int Racks = 6, Per = 3, N = Racks * Per, Chunks = 40, Blocks = 4, CopyBudget = 4, Timeout = 3;
const int Replicas = 3; // copies of every chunk
const int MinRacks = 2; // racks every chunk must span
const int Ticks = 30;
const int ServerFailsAt = 5;
const int RackFailsAt = 12;
const int SettledAfter = 16; // count recovery only once the rack failure has been detected
const int Corruptions = 5; // blocks hit by bit rot
long seed = 7;
int Rnd(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }
uint Mix(uint x) { x = unchecked((x ^ (x >> 16)) * 0x45d9f3bu); x = unchecked((x ^ (x >> 16)) * 0x45d9f3bu); return x ^ (x >> 16); }
int Rack(int n) => n / Per;
string B(bool v) => v ? "true" : "false";

// Chunkservers: each holds chunk id -> a replica (block values and a checksum per block).
var store = Enumerable.Range(0, N).Select(_ => new Dictionary<int, Replica>()).ToArray();
var alive = Enumerable.Repeat(true, N).ToArray();
var lastBeat = new int[N];
var declaredDead = new bool[N];
var replicas = Enumerable.Range(0, Chunks).Select(_ => new List<int>()).ToArray(); // the master's chunk map

int PickNode(Func<int, bool> ok) { while (true) { int n = Rnd(N); if (alive[n] && !declaredDead[n] && ok(n)) return n; } }
void WriteReplica(int c, int n, uint[] data) { store[n][c] = new Replica((uint[])data.Clone(), data.Select(Mix).ToArray()); replicas[c].Add(n); }
uint[] Original(int c) => Enumerable.Range(0, Blocks).Select(b => (uint)(c * 100 + b + 1)).ToArray();

void Place(int c) { // first anywhere, second in another rack, third beside the second
    int a = PickNode(_ => true);
    int b = PickNode(n => Rack(n) != Rack(a));
    int d = PickNode(n => Rack(n) == Rack(b) && n != b);
    foreach (var n in new[] { a, b, d }) WriteReplica(c, n, Original(c));
}

List<int> Live(int c) => replicas[c].Where(n => !declaredDead[n]).ToList(); // the master's view: only what heartbeats told it
int RacksOf(int c) => Live(c).Select(Rack).Distinct().Count();
bool Sound(Replica r) => r.Data.Select((v, b) => Mix(v) == r.Sums[b]).All(x => x);
int UnderReplicated() => Enumerable.Range(0, Chunks).Count(c => Live(c).Count < Replicas);

int ReReplicate(int budget) { // fewest surviving copies first, so the most endangered chunks are fixed first
    var queue = Enumerable.Range(0, Chunks).Where(c => Live(c).Count > 0 && Live(c).Count < Replicas)
        .OrderBy(c => Live(c).Count).ThenBy(c => c).Take(budget).ToList();
    foreach (int c in queue) {
        int src = Live(c).First(n => alive[n]);
        var held = replicas[c];
        int target = PickNode(n => !held.Contains(n) && (RacksOf(c) > 1 || Rack(n) != Rack(src)));
        WriteReplica(c, target, store[src][c].Data);
    }
    return queue.Count;
}

for (int c = 0; c < Chunks; c++) Place(c);
Console.WriteLine($"placed {Chunks} chunks, {Chunks * Replicas} replicas, every chunk on 2+ racks: {B(Enumerable.Range(0, Chunks).All(c => RacksOf(c) >= MinRacks))}");

int minCopies = Replicas, healthyAt = -1;
for (int tick = 1; tick <= Ticks; tick++) {
    if (tick == ServerFailsAt) alive[4] = false;                                  // one server dies
    if (tick == RackFailsAt) foreach (int n in new[] { 6, 7, 8 }) alive[n] = false; // then a whole rack
    for (int n = 0; n < N; n++) {
        if (alive[n]) lastBeat[n] = tick; // heartbeats
        if (!declaredDead[n] && tick - lastBeat[n] > Timeout) { declaredDead[n] = true; Console.WriteLine($"tick {tick}: server {n} declared dead, {UnderReplicated()} chunks under-replicated"); }
    }
    for (int c = 0; c < Chunks; c++) minCopies = Math.Min(minCopies, Live(c).Count);
    int copied = ReReplicate(CopyBudget);
    if (copied > 0) Console.WriteLine($"tick {tick}: copied {copied}, {UnderReplicated()} still under-replicated");
    if (tick > SettledAfter && healthyAt < 0 && UnderReplicated() == 0) healthyAt = tick;
}
Console.WriteLine($"fewest copies of any chunk: {minCopies}; fully replicated again at tick {healthyAt}");

int corrupted = 0, found = 0, repaired = 0;
while (corrupted < Corruptions) { // bit rot: flip a value in a stored block, leaving the stored checksum alone
    int c = Rnd(Chunks), n = Live(c)[Rnd(Replicas)];
    var r = store[n][c];
    if (Sound(r)) { r.Data[Rnd(Blocks)] ^= 1; corrupted++; } // skip a replica that is already damaged
}
for (int n = 0; n < N; n++) { // scrub: recompute every block checksum on every live server
    if (!alive[n]) continue;
    foreach (var (c, r) in store[n].ToList()) {
        if (Sound(r)) continue;
        found++; store[n].Remove(c); replicas[c].Remove(n);
    }
}
while (UnderReplicated() > 0) repaired += ReReplicate(CopyBudget);
Console.WriteLine($"corrupted {corrupted}, scrub found {found}, repaired {repaired}");

bool clean = Enumerable.Range(0, Chunks).All(c => Live(c).All(n => Sound(store[n][c]) && store[n][c].Data.SequenceEqual(Original(c))));
bool ok = clean && UnderReplicated() == 0 && minCopies >= 1 && found == corrupted
    && Enumerable.Range(0, Chunks).All(c => RacksOf(c) >= MinRacks && Live(c).Count == Replicas);
Console.WriteLine($"all replicas verify, 3 copies on 2+ racks: {B(ok)}");
return ok ? 0 : 1;

record Replica(uint[] Data, uint[] Sums);
