// A moderation pipeline in C#: a perceptual-hash lookup, then a three-way triage by classifier score,
// then a review queue that is served most-suspicious first and has limited reviewer capacity.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

const int HI = 950, LO = 200, MaxDistance = 4, Capacity = 100; // scores are in thousandths

const ulong Seed = 2024;
// A 32-bit hash is built from two 16-bit halves.
const int HalfWord = 65536, HashBits = 32;
const int Uploads = 3000, HarmfulPercent = 6, ScoreScale = 1000;
// An edited copy has 0..3 bits flipped.
const int KnownBad = 40, EditedCopyPercent = 40, MaxFlips = 4;
ulong seed = Seed;
// Linear congruential generator (Numerical Recipes constants).
int Random(int n)
{
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (int)((seed / 65536) % (ulong)n); // the high 16 bits are the better ones
}
uint Hash32() { uint a = (uint)Random(HalfWord); uint b = (uint)Random(HalfWord); return a * (uint)HalfWord + b; }
int Distance(uint a, uint b) => BitOperations.PopCount(a ^ b);

// Build 3,000 uploads. A harmful upload scores high and a harmless one scores low, with an overlap in the middle.
var known = new List<uint>();
var uploads = new List<Upload>();
for (int id = 0; id < Uploads; id++)
{
    bool harmful = Random(100) < HarmfulPercent;
    int score;
    if (harmful) { int a = Random(ScoreScale); int b = Random(ScoreScale); score = ScoreScale - a * b / ScoreScale; }
    else { int a = Random(ScoreScale); int b = Random(ScoreScale); int c = Random(ScoreScale); score = a * b * c / (ScoreScale * ScoreScale); }
    uint hash = Hash32();
    if (harmful && known.Count < KnownBad) known.Add(hash); // the first harmful uploads become the known-bad list
    else if (harmful && Random(100) < EditedCopyPercent) // a later harmful upload may be an edited copy of a known one
    {
        hash = known[Random(known.Count)];
        for (int i = Random(MaxFlips); i > 0; i--) hash ^= 1u << Random(HashBits); // flip up to 3 bits
    }
    uploads.Add(new Upload(id, harmful, score, hash));
}

var hashBlocked = new List<Upload>(); var removed = new List<Upload>(); var published = new List<Upload>(); var queued = new List<Upload>();
foreach (var u in uploads)
{
    if (known.Any(k => Distance(k, u.Hash) <= MaxDistance)) hashBlocked.Add(u);
    else if (u.Score >= HI) removed.Add(u);
    else if (u.Score < LO) published.Add(u);
    else queued.Add(u);
}

// The most suspicious first, and the lower id first when scores are equal. A reviewer is assumed to judge correctly.
queued = queued.OrderByDescending(u => u.Score).ThenBy(u => u.Id).ToList();
var reviewed = queued.Take(Capacity).ToList();
var overflow = queued.Skip(Capacity).ToList(); // published unreviewed after the deadline
var reviewRemoved = reviewed.Where(u => u.Harmful).ToList();

int Count(List<Upload> items) => items.Count(u => u.Harmful);
int Wrong(List<Upload> items) => items.Count - Count(items);
int missed = Count(published) + Count(overflow);
int totalHarmful = Count(uploads);
int removedTotal = hashBlocked.Count + removed.Count + reviewRemoved.Count;
int removedRight = Count(hashBlocked) + Count(removed) + reviewRemoved.Count;

Console.WriteLine($"{totalHarmful} harmful uploads out of {uploads.Count}, {known.Count} of them on the known-bad list");
Console.WriteLine($"hash match: {hashBlocked.Count} blocked, {Wrong(hashBlocked)} by mistake");
Console.WriteLine($"auto-removed: {removed.Count}, of which {Wrong(removed)} were harmless");
Console.WriteLine($"auto-published: {published.Count}, of which {Count(published)} were harmful");
Console.WriteLine($"review: {queued.Count} queued, {reviewed.Count} reviewed (lowest score reviewed {reviewed[^1].Score}), {overflow.Count} published unreviewed");
Console.WriteLine($"missed harm: {missed}; precision {100 * removedRight / removedTotal}%, recall {100 * removedRight / totalHarmful}%");

int everyone = hashBlocked.Count + removed.Count + published.Count + queued.Count;
bool ordered = reviewed.All(u => overflow.All(o => u.Score >= o.Score));
if (everyone != uploads.Count || !ordered || Wrong(reviewed) + Count(reviewed) != Capacity) Environment.Exit(1);

record Upload(int Id, bool Harmful, int Score, uint Hash);
