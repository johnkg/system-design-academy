// Full plus incremental backups with retention, a vault that refuses deletes, and restore verification, in C#.
// A toy database of 32 pages is backed up daily. Ransomware starts garbling pages on day 18, and on day 23 it tries to delete every backup.
using System;
using System.Collections.Generic;
using System.Linq;

const int Pages = 32, Days = 24, FullEvery = 7, Keep = 14, Lock = Keep + FullEvery, AttackDay = 18;

const uint Seed = 7;
const int PageCheck = 97; // every valid page value is a multiple of 97, so garbled pages are detectable
const int ValueRange = 1000, WritesPerDay = 6, GarbledPerDay = 8;

uint seed = Seed;
int Random(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

// A 32-bit FNV style hash of the whole database, recorded with each backup so a restore can be compared with the original.
uint Hash(int[] pages) { uint h = 2166136261; foreach (var v in pages) h = unchecked((h ^ (uint)v) * 16777619u); return h; }

var vault = new Vault();

// Keep every backup younger than Keep days and the chain it needs: the last full backup and each incremental after it.
void Prune(int today) {
    var needed = new HashSet<int>();
    foreach (var day in vault.Items.Keys)
        if (today - day < Keep) for (int d = day - day % FullEvery; d <= day; d++) needed.Add(d);
    foreach (var day in vault.Items.Keys.ToList()) if (!needed.Contains(day)) vault.Remove(day, today);
}

// Rebuild the database as it was on a given day: start from the full backup, then apply each incremental in order.
int[]? Restore(int day) {
    var state = new int[Pages];
    for (int d = day - day % FullEvery; d <= day; d++) {
        if (!vault.Items.ContainsKey(d)) return null;
        foreach (var (i, v) in vault.Items[d].Backup.Pages) state[i] = v;
    }
    return state;
}

var prod = Enumerable.Range(0, Pages).Select(i => (i + 1) * PageCheck).ToArray();
var dirty = Enumerable.Repeat(true, Pages).ToArray();
void Touch(int i, int v) { prod[i] = v; dirty[i] = true; }
int fulls = 0, written = 0;

for (int day = 0; day < Days; day++) {
    for (int k = 0; k < WritesPerDay; k++) { int i = Random(Pages); Touch(i, Random(ValueRange) * PageCheck); }
    if (day >= AttackDay) for (int k = 0; k < GarbledPerDay; k++) { int i = Random(Pages); int a = Random(ValueRange) * PageCheck + 1; Touch(i, a + Random(PageCheck - 1)); } // garbled
    bool full = day % FullEvery == 0;
    var pages = prod.Select((v, i) => (i, v)).Where(p => full || dirty[p.i]).ToList();
    vault.Put(new Backup(day, full, pages, Hash(prod)), Lock);
    Array.Fill(dirty, false);
    if (full) fulls++;
    written += pages.Count;
    Prune(day);
}
Console.WriteLine($"{fulls} full and {Days - fulls} incremental backups wrote {written} pages (daily fulls would write {Pages * Days})");
var days = vault.Items.Keys.OrderBy(d => d).ToList();
Console.WriteLine($"the vault holds {days.Count} backups, from day {days[0]} to day {days[^1]}");

int refused = days.Count(d => !vault.Remove(d, Days - 1));
Console.WriteLine($"attacker deletes {days.Count - refused} of {days.Count} backups, the vault refuses {refused}");

int clean = -1;
for (int day = Days - 1; day >= 0 && clean < 0; day--) {
    var state = Restore(day)!;
    bool hashOk = Hash(state) == vault.Items[day].Backup.Hash;
    bool dataOk = state.All(v => v % PageCheck == 0);
    Console.WriteLine($"restore test day {day}: hash {(hashOk ? "ok" : "BAD")}, data check {(dataOk ? "passed" : "FAILED")}");
    if (hashOk && dataOk) clean = day;
}
Console.WriteLine($"newest clean restore point: day {clean}, so {Days - 1 - clean} days of changes are lost");
if (refused != days.Count || clean != AttackDay - 1) Environment.Exit(1);

record Backup(int Day, bool Full, List<(int, int)> Pages, uint Hash);
record Item(Backup Backup, int LockUntil);

// The vault refuses to delete a backup before its lock expires, even for an administrator.
class Vault {
    public Dictionary<int, Item> Items = new();
    public void Put(Backup b, int lockDays) => Items[b.Day] = new Item(b, b.Day + lockDays);
    public bool Remove(int day, int today) => today >= Items[day].LockUntil && Items.Remove(day);
}
