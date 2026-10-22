// A tiny table format: immutable data files, snapshots listing them, and one atomic
// pointer swap (compare-and-swap) in the catalog. Concurrent writers use optimistic retries.
using System;
using System.Collections.Generic;
using System.Linq;

class Catalog
{
    public int Head = 0;
    public Dictionary<int, List<string>> Snapshots = new() { [0] = new List<string>() }; // version -> sorted file names
    public Dictionary<string, int> Rows = new(); // file name -> row count (data files are never modified)

    public bool Cas(int expected, List<string> files)
    {
        if (Head != expected) return false; // someone else committed first
        Head++;
        Snapshots[Head] = files;
        return true;
    }
    public int RowCount(int version) => Snapshots[version].Sum(f => Rows[f]);
}

static class Program
{
    const int MaxRetries = 4; // a writer gives up after this many lost compare-and-swaps

    // Optimistic commit built on snapshot `baseV`; on a lost race, validate and retry.
    static int Commit(Catalog cat, string who, int baseV, string[] adds, string[] removes, int maxRetries = MaxRetries)
    {
        int attempts = 0;
        while (true)
        {
            attempts++;
            var current = cat.Snapshots[baseV];
            var missing = removes.Where(r => !current.Contains(r)).ToList();
            if (missing.Count > 0)
            {
                Console.WriteLine($"{who}: abort, {missing[0]} was already replaced");
                return 0;
            }
            var files = current.Where(f => !removes.Contains(f)).Concat(adds).OrderBy(f => f, StringComparer.Ordinal).ToList();
            if (cat.Cas(baseV, files))
            {
                Console.WriteLine($"{who}: committed v{cat.Head} in {attempts} attempt(s) -> [{string.Join(",", files)}]");
                return cat.Head;
            }
            if (attempts > maxRetries)
            {
                Console.WriteLine($"{who}: gave up");
                return 0;
            }
            baseV = cat.Head; // re-read the new head, then validate and rebuild
        }
    }

    // Step 1 of every write: data files first, invisible until committed.
    static void WriteFile(Catalog cat, string name, int rows) => cat.Rows[name] = rows;

    static void Fail() => Environment.Exit(1);

    static void Main()
    {
        var cat = new Catalog();
        WriteFile(cat, "f1", 100);
        WriteFile(cat, "f2", 100);
        Commit(cat, "seed", 0, new[] { "f1", "f2" }, new string[0]);

        int reader = cat.Head; // a long query pins this snapshot
        int aBase = cat.Head, bBase = cat.Head;
        WriteFile(cat, "f3", 50);
        WriteFile(cat, "f4", 70);
        Commit(cat, "A append f3", aBase, new[] { "f3" }, new string[0]);
        Commit(cat, "B append f4", bBase, new[] { "f4" }, new string[0]); // loses the race, rebases, wins

        WriteFile(cat, "c1", 320);
        int cBase = cat.Head;
        WriteFile(cat, "f5", 30);
        Commit(cat, "C append f5", cat.Head, new[] { "f5" }, new string[0]);
        Commit(cat, "compact c1", cBase, new[] { "c1" }, new[] { "f1", "f2", "f3", "f4" }); // replays on top of C

        WriteFile(cat, "f5b", 30);
        WriteFile(cat, "c2", 350);
        int dBase = cat.Head;
        Commit(cat, "D rewrite f5", dBase, new[] { "f5b" }, new[] { "f5" });
        Commit(cat, "compact c2", dBase, new[] { "c2" }, new[] { "c1", "f5" }); // f5 is gone: real conflict

        foreach (int v in new[] { 1, 3, 5, cat.Head })
            Console.WriteLine($"v{v}: {cat.Snapshots[v].Count} files, {cat.RowCount(v)} rows");
        if (cat.RowCount(3) != 320 || cat.RowCount(5) != 350) Fail();
        if (cat.RowCount(reader) != 200) Fail(); // the pinned reader never saw any of it

        int[] keep = { cat.Head - 1, cat.Head }; // expire all but the last two snapshots
        var live = new HashSet<string>(keep.SelectMany(v => cat.Snapshots[v]));
        var dead = cat.Rows.Keys.Where(f => !live.Contains(f)).OrderBy(f => f, StringComparer.Ordinal).ToList();
        Console.WriteLine($"expire keeps v{keep[0]},v{keep[1]}; deletes {dead.Count} files: {string.Join(",", dead)}");
        if (string.Join(",", dead) != "c2,f1,f2,f3,f4") Fail();
    }
}
