// Optimistic concurrency with ETags: a versioned in-memory store with a conditional update (If-Match),
// and a seeded interleaving of support agents doing read-modify-write on shared customer records.
using System;
using System.Collections.Generic;
using System.Linq;

public class Store
{
    public int[] Notes;
    public int[] Version;
    readonly bool requireIfMatch;
    public Store(int records, bool requireIfMatch) { Notes = new int[records]; Version = new int[records]; this.requireIfMatch = requireIfMatch; }
    public string ETag(int id) => $"\"v{Version[id]}\""; // strong ETag derived from the row version
    // PUT with an optional If-Match header. Same effect as: UPDATE ... SET notes=?, version=version+1 WHERE id=? AND version=?
    public int Put(int id, int notes, string? ifMatch)
    {
        if (ifMatch == null && requireIfMatch) return 428; // Precondition Required
        if (ifMatch != null && ifMatch != ETag(id)) return 412; // Precondition Failed
        Notes[id] = notes;
        Version[id]++;
        return 200;
    }
}

public class Agent { public int Left; public int Id = -1; public int Notes; public string ETag = ""; }

public static class Program
{
    static long seed = 7;
    static int Rand(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

    // Each step, a random agent that still has work does one action: read a record, or write back its edit.
    static (int saved, int final, int lost, int conflicts) Run(bool useIfMatch, int agents, int records, int editsEach)
    {
        seed = 7;
        var store = new Store(records, false);
        var a = Enumerable.Range(0, agents).Select(_ => new Agent { Left = editsEach }).ToList();
        int saved = 0, conflicts = 0;
        while (a.Any(x => x.Left > 0))
        {
            var busy = a.Where(y => y.Left > 0).ToList();
            var x = busy[Rand(busy.Count)];
            if (x.Id < 0) // read phase
            {
                x.Id = Rand(records);
                x.Notes = store.Notes[x.Id]; x.ETag = store.ETag(x.Id);
            }
            else // write phase: add one note to what this agent saw
            {
                int status = store.Put(x.Id, x.Notes + 1, useIfMatch ? x.ETag : null);
                if (status == 200) { saved++; x.Left--; } else conflicts++; // on 412 keep the edit and re-read
                x.Id = -1;
            }
        }
        int final = store.Notes.Sum();
        return (saved, final, saved - final, conflicts);
    }

    public static void Main()
    {
        var none = Run(false, 4, 2, 10);
        var occ = Run(true, 4, 2, 10);
        Console.WriteLine($"no check:   saved={none.saved} final={none.final} lost={none.lost} conflicts={none.conflicts}");
        Console.WriteLine($"if-match:   saved={occ.saved} final={occ.final} lost={occ.lost} conflicts={occ.conflicts}");

        var strict = new Store(1, true);
        var first = strict.ETag(0);
        Console.WriteLine($"PUT without If-Match: {strict.Put(0, 1, null)}");
        Console.WriteLine($"PUT with {first}: {strict.Put(0, 1, first)}");
        Console.WriteLine($"PUT with stale {first}: {strict.Put(0, 2, first)}");

        if (occ.lost != 0 || occ.final != 40) throw new Exception("version check must not lose updates");
        if (none.lost <= 0) throw new Exception("the unchecked run should lose updates");
    }
}
