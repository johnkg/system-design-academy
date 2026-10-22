// A replica set failing over, in C#: five nodes with a replicated log (the oplog),
// writes acknowledged either by the primary alone (w:1) or by a majority (w:majority), then the primary dies and an election runs.
// A voter only grants its vote to a candidate whose log is at least as long as its own.
using System;
using System.Collections.Generic;
using System.Linq;

const int Nodes = 5, Majority = 3;
const int Trials = 8, SeedBase = 1000;
const int MinCrash = 40, CrashSpread = 20; // the primary dies after 40..59 writes
const int SlowNode = 4, SlowSteps = 2, Steps = 3; // per tick a secondary copies 0..2 entries, the slow one 0..1
const int ElectionTimeout = 150; // election timeouts are random in 0..149 ms
uint seed = 0;
int Next(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 8) % (uint)n); }

// A log is just its length here: every secondary holds a prefix of the primary's log.
(int crashAt, int commit, int winner, int keep, int denied, int rolledBack, int lostW1, int lostMajority) Trial(int n)
{
    seed = (uint)(SeedBase + n);
    var len = new int[Nodes];                              // node 0 is the primary
    int crashAt = MinCrash + Next(CrashSpread);
    var isMajorityWrite = new List<bool> { false };        // write k (1-based) uses w:majority when true
    for (int tick = 1; tick <= crashAt; tick++)
    {
        len[0]++;
        isMajorityWrite.Add(Next(2) == 1);
        for (int i = 1; i < Nodes; i++)                    // node 4 sits on a slow link
        {
            int step = Next(i == SlowNode ? SlowSteps : Steps);
            len[i] = Math.Min(len[0], len[i] + step);
        }
    }
    int commit = len.OrderByDescending(x => x).ToArray()[Majority - 1]; // the longest prefix that a majority holds
    int primaryLen = len[0];

    // Election among the four survivors, in the order their random timeouts fire.
    var order = new[] { 1, 2, 3, 4 }.Select(id => (id, timeout: Next(ElectionTimeout))).OrderBy(c => c.timeout).ThenBy(c => c.id).ToList();
    int winner = -1, denied = 0;
    foreach (var c in order)
    {
        int votes = 0;
        foreach (int v in new[] { 1, 2, 3, 4 }) if (len[c.id] >= len[v]) votes++;
        if (votes >= Majority) { winner = c.id; break; }
        denied++;                                          // too stale to collect a majority
    }
    int keep = len[winner];                                // everything after this is rolled back
    int lostW1 = 0, lostMajority = 0;
    for (int k = keep + 1; k <= primaryLen; k++)
    {
        if (!isMajorityWrite[k]) lostW1++;                 // w:1 was acknowledged right away, so the client was told "ok"
        else if (k <= commit) lostMajority++;              // acknowledged by a majority: must never happen
    }
    return (crashAt, commit, winner, keep, denied, primaryLen - keep, lostW1, lostMajority);
}

// A partition: a side can elect a primary only if it can reach a majority of the five nodes, otherwise it stays read-only.
string Partition(int reachable) =>
    $"partition: {reachable} of {Nodes} nodes reachable, can elect a primary: {(reachable >= Majority ? "true" : "false")}";

int tRolled = 0, tW1 = 0, tMajority = 0, tDenied = 0;
for (int n = 1; n <= Trials; n++)
{
    var r = Trial(n);
    Console.WriteLine($"trial {n}: crash after {r.crashAt} writes, committed {r.commit}, node {r.winner} wins with {r.keep}, stale candidates denied {r.denied}, rolled back {r.rolledBack}, lost w:1 acks {r.lostW1}, lost majority acks {r.lostMajority}");
    tRolled += r.rolledBack; tW1 += r.lostW1; tMajority += r.lostMajority; tDenied += r.denied;
}
Console.WriteLine($"total: rolled back {tRolled}, lost w:1 acks {tW1}, lost majority acks {tMajority}, denied {tDenied}");
foreach (int side in new[] { 1, 2, 3, 4 }) Console.WriteLine(Partition(side));
if (tMajority != 0) Environment.Exit(1);
