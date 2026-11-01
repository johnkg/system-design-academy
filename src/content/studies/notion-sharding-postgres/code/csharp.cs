// A miniature of the migration in Notion's 2021 post "Herding elephants: Lessons learned from sharding Postgres at Notion",
// in C# (a teaching model, not Notion's code): route each workspace to a logical shard and a physical database,
// double-write through an audit log, backfill a snapshot without overwriting newer records, check with dark reads, then switch.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

const int LogicalShards = 12; // Notion has 480
const int Databases = 3; // Notion has 32, with 15 logical shards on each
const int LostEvent = 2; // the catch-up script silently drops this audit event, so the checks have something to find

// The old monolith: "workspace/block" -> version of that block.
var monolith = new Dictionary<string, int>
{
    ["ws-ada/1"] = 1, ["ws-ada/2"] = 1, ["ws-ada/3"] = 1, ["ws-bob/1"] = 1, ["ws-bob/2"] = 1, ["ws-bob/3"] = 1, ["ws-cy/1"] = 1, ["ws-cy/2"] = 1,
};
var shards = new Dictionary<string, int>(); // the new databases, seen as one map
var auditLog = new List<(string Key, int Version)>();

// 32-bit FNV-1a, used to turn a workspace id into a logical shard.
static uint Fnv(string text)
{
    uint h = 0x811C9DC5;
    foreach (var b in Encoding.UTF8.GetBytes(text)) h = unchecked((h ^ b) * 0x01000193);
    return h;
}

static int ShardOf(string workspace) => (int)(Fnv(workspace) % LogicalShards);
static int DatabaseOf(int shard) => shard * Databases / LogicalShards;

// While migrating, a write goes to the monolith (still the source of truth) and is recorded in the audit log.
void ApplicationWrite(string key)
{
    var version = monolith.GetValueOrDefault(key, 0) + 1;
    monolith[key] = version;
    auditLog.Add((key, version));
}

// Replaying an event only ever moves a version forward, so replaying the same event twice does no harm.
void Replay(int index)
{
    var (key, version) = auditLog[index];
    shards[key] = Math.Max(shards.GetValueOrDefault(key, 0), version);
}

int DarkReads()
{
    var differing = monolith.Keys.OrderBy(key => key, StringComparer.Ordinal).Where(key => !shards.TryGetValue(key, out var seen) || seen != monolith[key]).ToList();
    var detail = differing.Count > 0 ? $" ({string.Join(", ", differing)})" : "";
    Console.WriteLine($"dark reads: compared {monolith.Count} rows, {differing.Count} differ{detail}");
    return differing.Count;
}

Console.WriteLine("--- routing: workspace id -> logical shard -> physical database");
foreach (var workspace in new[] { "ws-ada", "ws-bob", "ws-cy" })
{
    var shard = ShardOf(workspace);
    Console.WriteLine($"{workspace} -> schema{shard:D3} on database {DatabaseOf(shard)}");
}

Console.WriteLine("--- migration");
var snapshot = new Dictionary<string, int>(monolith); // the backfill copies from a snapshot taken now
foreach (var key in new[] { "ws-ada/2", "ws-bob/4", "ws-cy/1" }) ApplicationWrite(key);
Console.WriteLine($"writes during the migration: {auditLog.Count}, all recorded in the audit log");
Replay(0); // the catch-up script gets to the first event before the backfill reaches that row
var copied = 0;
var skipped = 0;
foreach (var key in snapshot.Keys.OrderBy(k => k, StringComparer.Ordinal))
{
    if (shards.GetValueOrDefault(key, 0) >= snapshot[key]) skipped++; // a newer record is already there
    else { shards[key] = snapshot[key]; copied++; }
}
Console.WriteLine($"backfill: copied {copied} rows, skipped {skipped} that already had a newer version");
var replayed = 0;
for (var i = 1; i < auditLog.Count; i++)
{
    if (i == LostEvent) continue;
    Replay(i);
    replayed++;
}
Console.WriteLine($"catch-up: events replayed {replayed}, events lost 1");
var before = DarkReads();
for (var i = 0; i < auditLog.Count; i++) Replay(i); // the repair: replay the whole log
var after = DarkReads();

Console.WriteLine("--- switch-over");
Console.WriteLine("five-minute window: reads and writes now go to the new databases, the reverse audit log holds 0 events");
var ok = copied == 7 && skipped == 1 && before == 1 && after == 0;
Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
if (!ok) Environment.Exit(1);
