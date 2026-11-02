// A miniature of Maglev hashing and connection tracking from Google's Maglev paper (NSDI 2016), in C#
// (a teaching model, not Google's code): each backend gets a permutation of the lookup table slots, the backends take turns
// claiming their next free preferred slot, a packet's hash picks a slot, and a per-machine connection table remembers the
// choice so that a connection survives changes to the backend set. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

uint Fnv(string text)
{
    uint h = 0x811C9DC5;
    foreach (char ch in text) h = unchecked((h ^ ch) * 0x01000193u);
    return h;
}

int[] Populate(List<(long Offset, long Skip)> backendParams, int size) // returns the lookup table (backend index per slot)
{
    var next = new long[backendParams.Count];
    var entry = Enumerable.Repeat(-1, size).ToArray();
    long Pref(int i, long j) => (backendParams[i].Offset + j * backendParams[i].Skip) % size; // permutation[i][j] = (offset + j * skip) mod M
    int filled = 0;
    while (true)
    {
        for (int i = 0; i < backendParams.Count; i++)
        {
            long c = Pref(i, next[i]);
            while (entry[c] >= 0) { next[i]++; c = Pref(i, next[i]); }
            entry[c] = i;
            next[i]++;
            filled++;
            if (filled == size) return entry;
        }
    }
}

List<(long Offset, long Skip)> ParamsFor(IEnumerable<string> names, int size) => // offset and skip come from two hash functions of the name
    names.Select(n => ((long)(Fnv("a" + n) % (uint)size), (long)(Fnv("b" + n) % (uint)(size - 1)) + 1)).ToList();

Console.WriteLine("--- the paper's small example: 3 backends, 7 slots, (offset, skip) = (3,4) (0,2) (3,1)");
var small = new List<(long, long)> { (3, 4), (0, 2), (3, 1) };
var smallNames = new[] { "B0", "B1", "B2" };
var before = Populate(small, 7);
var kept = new[] { 0, 2 }; // the backends left after B1 is removed
var after = Populate(new List<(long, long)> { small[0], small[2] }, 7).Select(i => kept[i]).ToArray();
Console.WriteLine("lookup table with B0, B1, B2: " + string.Join(" ", before.Select(i => smallNames[i])));
Console.WriteLine("lookup table without B1:      " + string.Join(" ", after.Select(i => smallNames[i])));
int moved = Enumerable.Range(0, 7).Count(k => before[k] != 1 && after[k] != before[k]);
Console.WriteLine($"slots that held B1: {before.Count(b => b == 1)}; other slots that changed: {moved}");

Console.WriteLine("--- 100 backends and a table of 65537 slots");
const int M = 65537;
var backends = Enumerable.Range(0, 100).Select(i => $"backend-{i}").ToList();
var table = Populate(ParamsFor(backends, M), M);
var counts = Enumerable.Range(0, backends.Count).Select(i => table.Count(e => e == i)).ToList();
Console.WriteLine($"slots per backend: min {counts.Min()}, max {counts.Max()}");
var reduced = backends.Where((_, i) => i != 7).ToList();
var table2 = Populate(ParamsFor(reduced, M), M);
string Name1(int k) => backends[table[k]];
string Name2(int k) => reduced[table2[k]];
int changed = Enumerable.Range(0, M).Count(k => Name1(k) != Name2(k));
int onRemoved = table.Count(e => e == 7);
Console.WriteLine($"removing backend-7: {onRemoved} slots held it, {changed} slots changed, {changed - onRemoved} of them were not backend-7's");

Console.WriteLine("--- 1000 connections when backend-7 is removed");
var flows = Enumerable.Range(0, 1000).Select(i => $"flow-{i}").ToList();
int Slot(string f) => (int)(Fnv(f) % M);
var tracked = flows.ToDictionary(f => f, f => Name1(Slot(f))); // the connection table of the Maglev machine that saw the first packets
int onGone = flows.Count(f => tracked[f] == "backend-7");
int withoutTable = flows.Count(f => Name1(Slot(f)) != Name2(Slot(f)));
int withTable = flows.Count(f => tracked[f] == "backend-7" && Name2(Slot(f)) != tracked[f]);
Console.WriteLine($"connections on backend-7: {onGone}");
Console.WriteLine($"same machine, with its connection table: {withTable} connections change backend (only the ones that had to)");
Console.WriteLine($"a different Maglev machine after an ECMP change, empty table: {withoutTable} connections change backend");
