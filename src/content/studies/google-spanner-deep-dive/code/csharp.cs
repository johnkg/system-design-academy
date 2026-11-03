// A miniature of the commit-wait idea in the Spanner paper "Spanner: Google's Globally Distributed Database", in C#
// (a teaching model, not Google's code): TrueTime returns an interval that is certain to contain the true time, a commit picks
// the latest end of that interval as its timestamp, and the commit waits until that timestamp has certainly passed. Without the
// wait, a transaction that starts after another has committed can be given an earlier timestamp. A snapshot read then reads
// the newest version at or below a timestamp, but only on a replica whose safe time has reached it.
// Everything is deterministic, so every run prints the same thing. All times are whole milliseconds and all numbers are made up.
using System;
using System.Collections.Generic;
using System.Linq;

const int Epsilon = 12; // the uncertainty TrueTime advertises: every clock is within this of the true time
const int OffsetA = 10; // coordinator A's clock runs this far ahead of true time
const int OffsetB = -10; // coordinator B's clock runs this far behind: the two are 20 apart, within twice Epsilon
const int PaxosMs = 5; // time for a Paxos commit

// TrueTime on a machine whose clock is `offset` ahead of true time `trueTime`.
static (int Earliest, int Latest) Now(int trueTime, int offset) => (trueTime + offset - Epsilon, trueTime + offset + Epsilon);

static bool After(int trueTime, int offset, int stamp) => Now(trueTime, offset).Earliest > stamp; // true when stamp has definitely passed

// T1 reaches coordinator A at true time 100 and takes the latest end of its interval as its commit timestamp.
static (int Stamp, int Visible) CommitFirst(bool commitWait)
{
    const int arrival = 100;
    var stamp = Now(arrival, OffsetA).Latest;
    var visible = arrival + PaxosMs; // when Paxos has finished
    if (commitWait) while (!After(visible, OffsetA, stamp)) visible++; // commit wait: nobody may see T1 until its stamp is in the past
    return (stamp, visible);
}

// T2 starts the moment T1 is visible and reaches coordinator B, whose clock is behind.
static int CommitSecond(int startsAt) => Now(startsAt, OffsetB).Latest;

static (bool Preserved, int FirstStamp, int Second) Ordering(bool commitWait)
{
    Console.WriteLine($"--- {(commitWait ? "with" : "without")} commit wait");
    var first = CommitFirst(commitWait);
    var second = CommitSecond(first.Visible);
    var preserved = second > first.Stamp;
    Console.WriteLine($"T1 timestamp {first.Stamp}, visible to clients at {first.Visible}");
    var verdict = preserved ? "ordered after T1" : "ordered BEFORE T1, external consistency broken";
    Console.WriteLine($"T2 starts at {first.Visible}, timestamp {second}: {verdict}");
    return (preserved, first.Stamp, second);
}

// A versioned row: each write is stored at its commit timestamp. A snapshot read takes the newest version at or below its timestamp.
var versions = new List<(int At, int Value)> { (50, 10) };

string SnapshotRead(int readAt, int replicaSafeTime)
{
    if (readAt > replicaSafeTime) return $"waits: this replica is only up to date to {replicaSafeTime}";
    var hit = versions.Where(v => v.At <= readAt).Last();
    return $"reads {hit.Value} (the version written at {hit.At}), no locks";
}

var withoutWait = Ordering(false);
var withWait = Ordering(true);
versions.Add((withWait.FirstStamp, 20));
versions.Add((withWait.Second, 30));

Console.WriteLine("--- lock-free snapshot reads");
foreach (var readTime in new[] { 100, withWait.FirstStamp, withWait.Second })
    Console.WriteLine($"read at {readTime}, replica up to date to {withWait.Second}: {SnapshotRead(readTime, withWait.Second)}");
Console.WriteLine($"read at {withWait.Second}, replica up to date to {withWait.FirstStamp}: {SnapshotRead(withWait.Second, withWait.FirstStamp)}");
var ok = !withoutWait.Preserved && withWait.Preserved && withWait.Second > withWait.FirstStamp;
Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
if (!ok) Environment.Exit(1);
