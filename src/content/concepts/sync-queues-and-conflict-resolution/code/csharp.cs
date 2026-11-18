// Two devices edit one shared record with 5 fields over 60 minutes. Device B is offline for a window and queues its edits
// (an outbox); at reconnect the queue is replayed and a policy settles the conflicts. Integers and fixed seeds only.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Fields = { "title", "notes", "due", "status", "priority" };
    const int OfflineStart = 15;  // minute when device B loses its connection
    const int DeleteAt = 23;      // minute when device A deletes the record, if the delete option is on
    const int EditCount = 14;
    const int AckLostPct = 25;    // share of replayed mutations whose acknowledgement is lost, so the device sends them again

    record Edit(int T, string Device, string Field, string Value);

    static Func<long> MakeRng(long seed)
    {
        long s = seed;
        return () => { s = (s * 48271) % 2147483647; return s; };
    }

    // One edit about every 4 minutes, by A or B, to one of the fields. The value says who wrote it and when.
    static List<Edit> Timeline()
    {
        var next = MakeRng(97);
        var edits = new List<Edit>();
        for (int k = 0; k < EditCount; k++)
        {
            int t = k * 4 + (int)(next() % 4);
            string device = next() % 2 == 0 ? "A" : "B";
            string field = Fields[(int)(next() % Fields.Length)];
            edits.Add(new Edit(t, device, field, $"{device}{t}"));
        }
        return edits;
    }

    // The last edit per field: earlier ones by the same device on the same field are overwritten by their own author.
    static List<Edit> Net(IEnumerable<Edit> items)
    {
        var result = new List<Edit>();
        foreach (var e in items)
        {
            int at = result.FindIndex(x => x.Field == e.Field);
            if (at >= 0) result[at] = e; else result.Add(e);
        }
        return result;
    }

    // policy: lww (whole record, newest clock wins), server (replayed mutations apply in arrival order),
    // merge (per field; notes are joined; other fields newest clock wins), ask (same-field conflicts go to the user).
    // skew: minutes that device B's clock runs ahead of the truth (negative: behind).
    static void Run(string policy, int offlineMin, int skew, bool deleteOn)
    {
        int end = OfflineStart + offlineMin;
        bool deleteInWindow = deleteOn && DeleteAt < end;
        // The scenario ends when B reconnects. A cannot edit a record it has deleted.
        var edits = Timeline().Where(e => e.T < end && !(deleteInWindow && e.Device == "A" && e.T >= DeleteAt)).ToList();
        var state = new Dictionary<string, string> { ["title"] = "Buy milk", ["notes"] = "-", ["due"] = "Fri", ["status"] = "open", ["priority"] = "low" };
        bool deleted = false;
        int lost = 0, merged = 0, toUser = 0;
        foreach (var e in edits) if (e.T < OfflineStart) state[e.Field] = e.Value;
        var before = new Dictionary<string, string>(state);
        var aWin = edits.Where(e => e.Device == "A" && e.T >= OfflineStart && e.T < end);
        var bQueue = edits.Where(e => e.Device == "B" && e.T >= OfflineStart && e.T < end).ToList(); // the outbox
        var aNet = Net(aWin);
        var bNet = Net(bQueue);
        foreach (var e in aNet) state[e.Field] = e.Value;   // A is online: the server has these already
        int BTs(Edit e) => e.T + skew;                      // what B's clock wrote on its edits
        bool both = aNet.Count > 0 && bNet.Count > 0;
        var aOnly = aNet.Where(a => !bNet.Any(b => b.Field == a.Field)).ToList();
        var bOnly = bNet.Where(b => !aNet.Any(a => a.Field == b.Field)).ToList();
        var same = bNet.Where(b => aNet.Any(a => a.Field == b.Field)).ToList();

        void FieldLevel()
        {
            if (both) merged += aOnly.Count + bOnly.Count;
            foreach (var e in bOnly) state[e.Field] = e.Value;
            foreach (var b in same)
            {
                var a = aNet.First(x => x.Field == b.Field);
                if (policy == "server") { state[b.Field] = b.Value; lost++; }                       // B arrived last: B overwrites A
                else if (policy == "merge" && b.Field == "notes") { state[b.Field] = $"{a.Value}+{b.Value}"; merged++; }
                else if (policy == "merge") { if (BTs(b) > a.T) state[b.Field] = b.Value; lost++; } // newest clock keeps its value
                else toUser++;                                                                      // ask: the user chooses, nothing is dropped
            }
        }

        if (deleteInWindow && bNet.Count > 0)
        {
            // delete versus edit
            int bLast = bNet.Max(BTs);
            if (policy == "lww")
            {
                if (DeleteAt > bLast) { deleted = true; lost += bNet.Count; }                       // the delete is newer: B's edits die with the record
                else
                {
                    foreach (var kv in before) state[kv.Key] = kv.Value;
                    foreach (var e in bNet) state[e.Field] = e.Value;
                    lost += aNet.Count + 1;
                }
            }
            else if (policy == "server") { deleted = true; lost += bNet.Count; }                    // the tombstone arrived first
            else { FieldLevel(); if (policy == "merge") lost++; else toUser++; }                    // keep the record: delete lost, or ask
        }
        else
        {
            if (deleteInWindow) deleted = true;
            if (!both) { foreach (var e in bNet) state[e.Field] = e.Value; }
            else if (policy == "lww")
            {
                int aLast = aNet.Max(e => e.T), bLast = bNet.Max(BTs);
                if (bLast >= aLast)
                {
                    foreach (var kv in before) state[kv.Key] = kv.Value;
                    foreach (var e in bNet) state[e.Field] = e.Value;
                    lost += aNet.Count;
                }
                else lost += bNet.Count;
            }
            else FieldLevel();
        }
        // The outbox: each mutation has an id. Some acknowledgements are lost, so the device sends them again.
        var next = MakeRng(17);
        int bytes = 0, dupes = 0;
        for (int j = 0; j < bQueue.Count; j++)
        {
            bytes += $"B-{j + 1}".Length + bQueue[j].Field.Length + bQueue[j].Value.Length + 24;
            if (next() % 100 < AckLostPct) dupes++;
        }
        string record = deleted ? "DELETED" : string.Join(" ", Fields.Select(f => $"{f}={state[f]}"));
        Console.WriteLine($"{policy.PadRight(6)} lost {lost}, merged {merged}, asked {toUser}; outbox {bQueue.Count} mutations, {bytes} bytes; duplicate sends ignored {dupes}");
        Console.WriteLine($"       {record}");
    }

    public static void Main()
    {
        var scenarios = new (string Label, int Offline, int Skew, bool Delete)[]
        {
            ("20 minutes offline, clocks agree", 20, 0, false),
            ("20 minutes offline, device B clock 8 minutes behind", 20, -8, false),
            ("20 minutes offline, A deletes the record", 20, 0, true),
            ("5 minutes offline, clocks agree", 5, 0, false),
        };
        foreach (var s in scenarios)
        {
            Console.WriteLine($"-- {s.Label}");
            foreach (var policy in new[] { "lww", "server", "merge", "ask" }) Run(policy, s.Offline, s.Skew, s.Delete);
        }
    }
}
