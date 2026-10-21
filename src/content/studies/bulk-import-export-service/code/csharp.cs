// A bulk import in C#: a resumable chunked upload, row-by-row validation with an error report,
// an idempotent re-run, and a fair scheduler that stops one big tenant from starving small ones.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Rng
{
    const int Seed = 7;
    static long seed = Seed;
    // Linear congruential generator (Numerical Recipes constants), high 16 bits.
    public static int Next(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }
}

// The server remembers which chunks arrived, so a client that reconnects only sends the missing ones.
public class Upload
{
    public readonly int Total;
    public readonly Dictionary<int, string[]> Chunks = new();
    public int Dupes;
    public Upload(int total) { Total = total; }
    public void Put(int i, string[] rows) { if (Chunks.ContainsKey(i)) Dupes++; else Chunks[i] = rows; } // a repeated chunk is ignored
    public List<int> Missing() => Enumerable.Range(0, Total).Where(i => !Chunks.ContainsKey(i)).ToList();
}

public record Rec(int Id, string Email, int Qty);

public static class Program
{
    const int Chunk = 8;
    const int Rows = 44, MaxQty = 9;
    const int RowKinds = 10; // 1 in 10 rows has a bad email, 1 in 10 a bad quantity
    static readonly Dictionary<uint, string> Jobs = new();

    static bool AllDigits(string s) => s.Length > 0 && s.All(c => c >= '0' && c <= '9');

    // Streaming validation: one row at a time, never holding the whole file, and every problem gets its line number.
    static void Validate(Upload up, Action<Rec> onValid, List<string> errors)
    {
        for (int i = 0; i < up.Total; i++)
            for (int j = 0; j < up.Chunks[i].Length; j++)
            {
                var p = up.Chunks[i][j].Split(',');
                string at = $"line {i * Chunk + j + 1}";
                if (!AllDigits(p[0])) errors.Add($"{at}: id");
                else if (!p[1].Contains('@')) errors.Add($"{at}: email");
                else if (p[2].Length != 1 || p[2][0] < '1' || p[2][0] > '9') errors.Add($"{at}: qty");
                else onValid(new Rec(int.Parse(p[0]), p[1], int.Parse(p[2])));
            }
    }

    // An upsert by natural key: applying the same row again changes nothing, so a re-run is safe.
    static bool Apply(Dictionary<int, Rec> store, Rec rec)
    {
        if (store.TryGetValue(rec.Id, out var cur) && cur == rec) return false;
        store[rec.Id] = rec;
        return true;
    }

    // The job key is a hash of the content, so submitting the same file twice returns the same job.
    static uint Fnv(string s) { uint h = 2166136261; foreach (char c in s) h = unchecked((h ^ c) * 16777619); return h; }
    static string Submit(string[] rows)
    {
        uint key = Fnv(string.Join("\n", rows));
        if (!Jobs.ContainsKey(key)) Jobs[key] = $"job-{Jobs.Count + 1}";
        return Jobs[key];
    }

    // Fair: one chunk per tenant per round. FIFO: the first tenant's queue is drained before the next.
    static string Schedule(string[] names, int[] queue, bool fair)
    {
        var left = (int[])queue.Clone();
        var done = new int[names.Length];
        int tick = 0;
        void Take(int n) { left[n]--; tick++; if (left[n] == 0) done[n] = tick; }
        while (left.Any(x => x > 0))
        {
            if (fair) { for (int n = 0; n < names.Length; n++) if (left[n] > 0) Take(n); }
            else Take(Array.FindIndex(left, x => x > 0));
        }
        return string.Join(" ", names.Select((n, k) => $"{n}={done[k]}"));
    }

    public static int Main()
    {
        var rows = new List<string>();
        for (int i = 1; i <= Rows; i++)
        {
            int r = Rng.Next(RowKinds);
            rows.Add(r == 0 ? $"{i},bad-email,3" : r == 1 ? $"{i},u{i}@x.io,many" : $"{i},u{i}@x.io,{1 + Rng.Next(MaxQty)}");
        }
        var up = new Upload((rows.Count + Chunk - 1) / Chunk);
        string[] Slice(int i) => rows.Skip(i * Chunk).Take(Chunk).ToArray();
        foreach (int i in new[] { 0, 1, 2, 1 }) up.Put(i, Slice(i)); // the connection drops here, and chunk 1 was sent twice
        var gaps = up.Missing();
        Console.WriteLine($"after the drop the server is missing chunks {string.Join(",", gaps)} and ignored {up.Dupes} repeat");
        foreach (int i in gaps) up.Put(i, Slice(i));

        var store = new Dictionary<int, Rec>();
        var errors = new List<string>();
        int written = 0, again = 0;
        Validate(up, rec => { if (Apply(store, rec)) written++; }, errors);
        Console.WriteLine($"{Submit(rows.ToArray())}: {rows.Count} rows, {written} written, {errors.Count} rejected");
        Console.WriteLine($"first errors: {string.Join("; ", errors.Take(3))}");

        Validate(up, rec => { if (Apply(store, rec)) again++; }, new List<string>());
        Console.WriteLine($"re-run: {again} writes, same job: {(Submit(rows.ToArray()) == "job-1" ? "true" : "false")}");

        var names = new[] { "A", "B", "C" };
        var queues = new[] { 30, 4, 4 };
        foreach (bool fair in new[] { false, true }) Console.WriteLine($"finish tick, {(fair ? "fair" : "FIFO")}: {Schedule(names, queues, fair)}");
        return written + errors.Count != rows.Count || again != 0 || store.Count != written ? 1 : 0;
    }
}
