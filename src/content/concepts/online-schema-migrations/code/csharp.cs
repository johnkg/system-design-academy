// Splitting users.full_name into first_name|last_name while live writes keep arriving.
// Four migration orders run on the same seeded write stream; only the safe ones end equal to the old table.
using System;
using System.Linq;

const int N = 1000, CHUNK = 50, WRITES = 12; // rows, rows per backfill batch, live writes between steps
uint seed = 12345;
int Rand(int n) { seed = (seed * 1103515245u + 12345u) & 0x7fffffffu; return (int)((seed >> 8) % (uint)n); }
string Split(string name) { int i = name.IndexOf(' '); return name[..i] + "|" + name[(i + 1)..]; }

(int wrong, int version) Migrate(string mode)
{
    seed = 12345;
    var old = Enumerable.Range(0, N).Select(i => $"f{i} l{i}").ToArray(); // the live table: full_name
    var next = new string?[N];                                              // the new columns (or the shadow table)
    bool dualWrite = mode != "backfill-first";                              // is the app writing both shapes yet?
    int version = 0;

    void LiveWrites()                                                       // the application keeps renaming users
    {
        for (int k = 0; k < WRITES; k++)
        {
            int id = Rand(N);
            old[id] = $"f{id}w{++version} l{id}";
            if (dualWrite || mode == "shadow") next[id] = Split(old[id]);   // dual-write, or REPLACE from the change log
        }
    }

    for (int start = 0; start < N; start += CHUNK)
    {
        if (mode == "backfill-first" && start == N / 2) dualWrite = true;   // dual-write deployed too late
        int end = start + CHUNK;
        if (mode == "rmw" || mode == "shadow")
        {
            var snapshot = old[start..end];                                 // read the batch ...
            LiveWrites();                                                   // ... a live write lands in between ...
            for (int i = start; i < end; i++)
            {
                string derived = Split(snapshot[i - start]);
                if (mode == "rmw") next[i] = derived;                       // ... blind write-back clobbers it
                else if (next[i] == null) next[i] = derived;                // INSERT IGNORE: the log already won
            }
        }
        else
        {
            LiveWrites();
            for (int i = start; i < end; i++) if (next[i] == null) next[i] = Split(old[i]); // UPDATE ... WHERE first_name IS NULL
        }
        LiveWrites();
    }
    int wrong = 0;
    for (int i = 0; i < N; i++) if (next[i] != Split(old[i])) wrong++;
    return (wrong, version);
}

var modes = new (string label, string mode, bool mustBeSafe)[]
{
    ("dual-write first, then backfill", "dual", true),
    ("backfill first, dual-write late", "backfill-first", false),
    ("backfill reads, then blind writes", "rmw", false),
    ("shadow copy + change log", "shadow", true),
};
foreach (var (label, mode, mustBeSafe) in modes)
{
    var (wrong, version) = Migrate(mode);
    Console.WriteLine($"{label}: {wrong} of {N} rows wrong after {version} live writes");
    if (mustBeSafe != (wrong == 0)) { Console.Error.WriteLine("invariant violated: " + label); return 1; }
}
Console.WriteLine("safe orders match the old table; unsafe orders lose updates");
return 0;
