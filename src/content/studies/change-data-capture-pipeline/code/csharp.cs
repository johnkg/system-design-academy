// Change data capture in miniature, in C#:
// a table that appends every change to a log, a connector that reads the log with committed offsets and crashes once,
// an idempotent sink, and a polling copy for comparison. Values are positive, and 0 means "no row".
using System;
using System.Collections.Generic;
using System.Linq;

long seed = 7;
int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

var table = new Dictionary<int, (int Value, int UpdatedAt)>(); // key -> row
var log = new List<Change>();                                  // the source's write-ahead log: one entry per committed change, in order

void Write(string op, int key, int value)
{
    int before = table.TryGetValue(key, out var row) ? row.Value : 0;
    int lsn = log.Count + 1;
    if (op == "delete") table.Remove(key); else table[key] = (value, lsn);
    log.Add(new Change(lsn, op, key, before, op == "delete" ? 0 : value));
}

// Polling by updated_at: it copies rows changed since its cursor, and a deleted row is simply not there to be found.
var polled = new Dictionary<int, int>();
int cursor = 0;
void Poll()
{
    foreach (var (key, row) in table) if (row.UpdatedAt > cursor) polled[key] = row.Value;
    cursor = log.Count;
}

for (int i = 0; i < 400; i++) // 400 changes to 25 keys
{
    int key = Random(25);
    if (!table.ContainsKey(key)) Write("insert", key, 1 + Random(1000));
    else if (Random(10) < 2) Write("delete", key, 0);
    else Write("update", key, 1 + Random(1000));
    if ((i + 1) % 50 == 0) Poll();
}

// The sink keeps the log position of the last change it applied per key, and ignores anything not newer.
var sinkRows = new Dictionary<int, int>();
var lastLsn = new Dictionary<int, int>();
int ignored = 0;
void Apply(Change e)
{
    if (e.Lsn <= lastLsn.GetValueOrDefault(e.Key, 0)) { ignored++; return; }
    lastLsn[e.Key] = e.Lsn; // a delete keeps its position too, so a replayed older insert cannot bring the row back
    if (e.Op == "delete") sinkRows.Remove(e.Key); else sinkRows[e.Key] = e.After;
}

int deltaTotal = 0; // a careless sink that adds (after - before) for every event it receives
int delivered = 0, committed = 0, batches = 0;
bool crashed = false;
while (committed < log.Count)
{
    var batch = log.Skip(committed).Take(25).ToList();
    foreach (var e in batch) { Apply(e); deltaTotal += e.After - e.Before; delivered++; }
    batches++;
    if (batches == 6 && !crashed) { crashed = true; continue; } // crash after applying the batch, before committing its offset: restart from the old offset
    committed += batch.Count;
}

int sourceTotal = table.Values.Sum(r => r.Value);
int ghosts = polled.Keys.Count(k => !table.ContainsKey(k));
bool sameRows = table.Count == sinkRows.Count && table.All(kv => sinkRows.GetValueOrDefault(kv.Key, -1) == kv.Value.Value);
string Lower(bool b) => b ? "true" : "false";
Console.WriteLine($"source: {log.Count} changes, {table.Count} rows, total {sourceTotal}");
Console.WriteLine($"polling copy: {polled.Count} rows, {ghosts} deleted rows still present");
Console.WriteLine($"log-based: {delivered} events delivered for {log.Count} changes, {delivered - log.Count} replayed, {ignored} ignored by the sink");
Console.WriteLine($"idempotent sink matches the source: {Lower(sameRows)}, total {sinkRows.Values.Sum()}");
Console.WriteLine($"delta-adding sink total: {deltaTotal}, off by {deltaTotal - sourceTotal}");
if (!sameRows || ghosts == 0 || ignored != delivered - log.Count || delivered == log.Count || deltaTotal == sourceTotal) Environment.Exit(1);

record Change(int Lsn, string Op, int Key, int Before, int After);
