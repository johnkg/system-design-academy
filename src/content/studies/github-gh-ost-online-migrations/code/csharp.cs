// A miniature of the ideas in GitHub's 2016 post on gh-ost and in gh-ost's documentation of its cut-over, in C#
// (a teaching model, not GitHub's code): copy rows into a ghost table in chunks, replay the change log into it instead of
// using triggers, throttle on replica lag, and swap the tables with a sentry so that a failed cut-over can be retried.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
using System;
using System.Collections.Generic;
using System.Linq;

const int Rows = 10; // rows in the original table
const int Chunk = 3; // rows copied at a time
const int LagLimit = 2; // ticks of replica lag above which the migration pauses
var writeTicks = new[] { 1, 2, 4 }; // ticks in which the application updates a row

// The original table: row id -> version. The change log is what gh-ost reads instead of triggers.
var original = Enumerable.Range(1, Rows).ToDictionary(row => row, _ => 1);
var ghost = new Dictionary<int, int>();
var log = new List<(int Row, int Version)>(); // change events
var logPosition = 0; // how much of the log has been applied to the ghost table

// The application changes row (tick + 1) to a newer version. The change is written to the log, not copied by a trigger.
void ApplicationWrite(int tick)
{
    var row = tick + 1;
    original[row] += 1;
    log.Add((row, original[row]));
}

int CopyChunk(int start)
{
    var copied = 0;
    for (var row = start; row < start + Chunk && row <= Rows; row++)
    {
        // A row the log has not yet replayed is copied with its current version; replaying the log later only moves versions forward.
        ghost[row] = Math.Max(ghost.GetValueOrDefault(row, 0), original[row]);
        copied++;
    }
    return copied;
}

int ApplyLog()
{
    var applied = 0;
    for (; logPosition < log.Count; logPosition++)
    {
        var (row, version) = log[logPosition];
        if (ghost.ContainsKey(row)) ghost[row] = Math.Max(ghost[row], version);
        applied++;
    }
    return applied;
}

// Replica lag for each tick: the replica falls behind during the busy ticks.
int LagAt(int tick) => tick >= 3 && tick <= 5 ? 3 : 0;

int Migrate()
{
    Console.WriteLine("--- migration: copy chunks, replay the log, pause when the replica lags");
    var next = 1;
    var pausedTicks = 0;
    for (var tick = 1; next <= Rows || logPosition < log.Count; tick++)
    {
        if (writeTicks.Contains(tick)) ApplicationWrite(tick);
        if (LagAt(tick) > LagLimit)
        {
            pausedTicks++;
            Console.WriteLine($"tick {tick}: replica lag {LagAt(tick)} is over {LagLimit}, throttled, no writes");
            continue;
        }
        var copied = next <= Rows ? CopyChunk(next) : 0;
        next += copied;
        var applied = ApplyLog();
        Console.WriteLine($"tick {tick}: copied {copied} rows, log events replayed {applied}, ghost has {ghost.Count} of {Rows} rows");
    }
    return pausedTicks;
}

// Cut-over: a sentry blocks the rename until everything is ready, and a failed attempt leaves the original in place.
(string LiveTable, int Attempts) CutOver(bool failFirstAttempt)
{
    var liveTable = "original";
    for (var attempt = 1; ; attempt++)
    {
        var failed = failFirstAttempt && attempt == 1;
        var message = failed ? $"connection lost, table is still the {liveTable}, queries released" : "atomic rename done";
        Console.WriteLine($"cut-over attempt {attempt}: {message}");
        if (!failed) return ("ghost", attempt);
    }
}

var pausedTotal = Migrate();
var identical = original.All(pair => ghost.TryGetValue(pair.Key, out var version) && version == pair.Value);
Console.WriteLine($"tables identical: {(identical ? "yes" : "no")}, ticks paused: {pausedTotal}");
Console.WriteLine("--- cut-over");
var (finalTable, attemptCount) = CutOver(true);
Console.WriteLine($"live table: {finalTable} after {attemptCount} attempts");
var ok = identical && pausedTotal == 3 && finalTable == "ghost" && attemptCount == 2;
Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
if (!ok) Environment.Exit(1);
