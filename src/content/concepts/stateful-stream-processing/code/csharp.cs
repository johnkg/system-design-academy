// Keyed counters with checkpoints: state + input offset are snapshotted together, a crash restores both and replays.
using System;
using System.Collections.Generic;
using System.Linq;

const int N = 600, KEYS = 12, OPS = 3, CRASH = 330, COMMIT_EVERY = 120;

// Seeded orders stream: event i is "customer k placed an order"; low ids are the busy customers.
var events = new int[N];
long x = 12345;
for (int i = 0; i < N; i++)
{
    x = (x * 48271) % 2147483647;
    long r = x % 1000;
    events[i] = (int)((r * r * KEYS) / 1000000);
}
// key -> key group -> operator instance: each key lives on exactly one instance.
static int OpOf(int k) => (((k * 7 + 2) % 12) * OPS) / 12;

void Must(bool c, string m) { if (!c) { Console.WriteLine("FAILED: " + m); Environment.Exit(1); } }

Result Run(int interval, string kind, bool separate)
{
    var records = new List<int>(); var pending = new List<int>();
    var table = new int[KEYS]; int writes = 0;
    int[][] Zero() => Enumerable.Range(0, OPS).Select(_ => new int[KEYS]).ToArray();
    int[][] Copy(int[][] s) => s.Select(a => (int[])a.Clone()).ToArray();
    var ops = Zero(); var snapOps = Zero(); int snapOff = 0;
    void Process(int off)
    {
        int k = events[off], o = OpOf(k);
        ops[o][k]++;
        if (kind == "plain") records.Add(off);
        else if (kind == "idempotent") { table[k] = ops[o][k]; writes++; } // keyed upsert
        else pending.Add(off); // transactional: held in an open transaction
    }
    void Commit() { records.AddRange(pending); pending.Clear(); } // checkpoint completed
    for (int off = 0; off < CRASH; off++)
    {
        Process(off);
        if (interval > 0 && (off + 1) % interval == 0) { snapOps = Copy(ops); snapOff = off + 1; Commit(); }
    }
    int aborted = pending.Count; pending.Clear(); // crash: the open transaction is rolled back, memory is gone
    int restore = separate ? (CRASH / COMMIT_EVERY) * COMMIT_EVERY : snapOff;
    ops = Copy(snapOps);
    for (int off = restore; off < CRASH; off++) Process(off);
    Commit();
    var truth = new int[KEYS];
    for (int i = 0; i < CRASH; i++) truth[events[i]]++;
    int wrong = 0;
    for (int k = 0; k < KEYS; k++) if (ops[OpOf(k)][k] != truth[k]) wrong++;
    int rows, dup = 0, missing = 0, extra = 0;
    if (kind == "idempotent") { rows = table.Count(c => c > 0); extra = writes - CRASH; }
    else
    {
        rows = records.Count;
        int distinct = records.Distinct().Count();
        dup = rows - distinct; missing = CRASH - distinct; extra = aborted;
    }
    var r = new Result(restore, CRASH - restore, Math.Max(0, restore - snapOff), Math.Max(0, snapOff - restore), wrong, rows, dup, missing, extra);
    Console.WriteLine($"i={interval} {kind} separate={(separate ? "true" : "false")} restore={r.Restore} replayed={r.Replayed} lost={r.Lost} double={r.Double} wrong_keys={r.Wrong} rows={r.Rows} dup={r.Dup} missing={r.Missing} extra={r.Extra}");
    return r;
}

foreach (int i in new[] { 0, 50, 200 }) Must(Run(i, "plain", false).Wrong == 0, "state exact with checkpoints");
var idem = Run(50, "idempotent", false);
var tx = Run(50, "transactional", false);
Run(200, "transactional", false);
var plain = Run(50, "plain", false);
Must(plain.Dup == 30 && plain.Replayed == 30, "plain sink repeats the replayed outputs");
Must(idem.Dup == 0 && idem.Extra == 30 && idem.Wrong == 0, "upsert absorbs the replay");
Must(tx.Dup == 0 && tx.Missing == 0 && tx.Extra == 30, "2PC sink: no duplicates, open transaction aborted");
var behind = Run(50, "plain", true); var ahead = Run(200, "plain", true);
Must(behind.Double == 60 && behind.Wrong > 0, "offset committed separately, behind the state: double counting");
Must(ahead.Lost == 40 && ahead.Wrong > 0, "offset committed separately, ahead of the state: lost events");
Console.WriteLine("ok");

record Result(int Restore, int Replayed, int Lost, int Double, int Wrong, int Rows, int Dup, int Missing, int Extra);
