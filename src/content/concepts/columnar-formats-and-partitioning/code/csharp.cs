// A miniature columnar file writer and reader: partitions, row groups, per-chunk min/max stats and column pruning.
#nullable disable
using System;
using System.Collections.Generic;
using System.Linq;

const int DAYS = 10, ROWS_PER_DAY = 300, RG_ROWS = 100, PAYLOAD = 40;
string[] COUNTRIES = { "US", "DE", "BRA", "IND", "JPN" };
// Amounts are 0..MAX_AMOUNT-1.
const int SEED = 42, USER_IDS = 100000, MAX_AMOUNT = 1000;
const int BITS_PER_BYTE = 8, HEADER_BYTES = 8;
// Footer: the schema, then offset and stats for every chunk.
const int FOOTER_SCHEMA_BYTES = 100, CHUNK_META_BYTES = 48, COLUMN_COUNT = 4;
// Fixed-width fields in the row format.
const int USER_BYTES = 4, AMOUNT_BYTES = 2;
ulong seed = SEED;
// Linear congruential generator (Numerical Recipes constants).
ulong Next() { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return seed; }

List<Row>[] MakeRows(bool clustered)
{
    seed = SEED;
    var byDay = new List<Row>[DAYS];
    for (int d = 0; d < DAYS; d++)
    {
        var rows = new List<Row>();
        for (int i = 0; i < ROWS_PER_DAY; i++)
        {
            int user = (int)(Next() % USER_IDS);
            string country = COUNTRIES[Next() % (ulong)COUNTRIES.Length];
            int amount = (int)(Next() % MAX_AMOUNT);
            rows.Add(new Row(d, user, country, amount, i));
        }
        if (clustered) rows = rows.OrderBy(r => r.Amount).ThenBy(r => r.I).ToList(); // sort inside the partition
        byDay[d] = rows;
    }
    return byDay;
}

int BitsFor(int range) { int b = 0; while (range > 0) { b++; range /= 2; } return b; }
int Packed(int n, int bits) => (n * bits + BITS_PER_BYTE - 1) / BITS_PER_BYTE + HEADER_BYTES; // bit-packed values plus an 8-byte header

Chunk Encode(string name, List<int> ints, List<string> strs)
{
    if (name == "country") // dictionary encoding: distinct strings once, then small integer codes
    {
        var dict = strs.Distinct().ToList();
        int dictBytes = dict.Sum(v => v.Length + 1);
        return new Chunk(dictBytes + Packed(strs.Count, BitsFor(dict.Count - 1)), 0, 0);
    }
    if (name == "payload") return new Chunk(PAYLOAD * ints.Count + HEADER_BYTES, 0, 0); // opaque blob, stored plain
    int mn = ints.Min(), mx = ints.Max(); // frame of reference: store (value - min) in few bits
    return new Chunk(Packed(ints.Count, BitsFor(mx - mn)), mn, mx);
}

File WriteFile(List<Row> rows) // one file per partition, split into row groups, one chunk per column
{
    var groups = new List<Group>();
    for (int s = 0; s < rows.Count; s += RG_ROWS)
    {
        var part = rows.Skip(s).Take(RG_ROWS).ToList();
        var chunks = new Dictionary<string, Chunk>
        {
            ["user"] = Encode("user", part.Select(r => r.User).ToList(), null),
            ["country"] = Encode("country", null, part.Select(r => r.Country).ToList()),
            ["amount"] = Encode("amount", part.Select(r => r.Amount).ToList(), null),
            ["payload"] = Encode("payload", part.Select(r => 0).ToList(), null),
        };
        groups.Add(new Group(part, chunks));
    }
    return new File(groups, FOOTER_SCHEMA_BYTES + CHUNK_META_BYTES * COLUMN_COUNT * groups.Count); // schema plus every chunk's offset and stats
}

int RowFormatBytes(List<Row> rows) => rows.Sum(r => USER_BYTES + AMOUNT_BYTES + r.Country.Length + 1 + PAYLOAD);

// SELECT sum(amount) FROM t WHERE day >= fromDay AND amount >= minAmount
Result Query(File[] files, List<Row>[] byDay, string mode, int fromDay, int minAmount, string[] cols)
{
    int bytes = 0, sum = 0, read = 0, seen = 0;
    for (int d = fromDay; d < DAYS; d++) // partition pruning: days before fromDay are never opened
    {
        if (mode == "row")
        {
            bytes += RowFormatBytes(byDay[d]);
            sum += byDay[d].Where(r => r.Amount >= minAmount).Sum(r => r.Amount);
            continue;
        }
        bytes += files[d].Footer;
        foreach (var g in files[d].Groups)
        {
            seen++;
            if (mode == "stats" && g.Chunks["amount"].Max < minAmount) continue; // min/max says no row can match
            read++;
            foreach (var c in cols) bytes += g.Chunks[c].Bytes; // only the requested column chunks are read
            sum += g.Rows.Where(r => r.Amount >= minAmount).Sum(r => r.Amount);
        }
    }
    return new Result(bytes, sum, read, seen);
}

foreach (bool clustered in new[] { false, true })
{
    var byDay = MakeRows(clustered);
    var files = byDay.Select(WriteFile).ToArray();
    Console.WriteLine("data " + (clustered ? "sorted by amount inside each day" : "in arrival order"));
    var cases = new (string, int, int)[] { ("all days, amount>=0", 0, 0), ("last 3 days, amount>=0", 7, 0), ("last 3 days, amount>=900", 7, 900) };
    foreach (var (label, from, min) in cases)
    {
        var r = Query(files, byDay, "row", from, min, null);
        var c = Query(files, byDay, "columnar", from, min, new[] { "amount" });
        var s = Query(files, byDay, "stats", from, min, new[] { "amount" });
        if (r.Sum != c.Sum || c.Sum != s.Sum) { Console.WriteLine("MISMATCH"); return 1; }
        Console.WriteLine($"  {label.PadRight(26)} row {r.Bytes.ToString().PadLeft(6)}  columnar {c.Bytes.ToString().PadLeft(6)}  +stats {s.Bytes.ToString().PadLeft(6)} ({s.Read}/{s.Total} groups)  sum {s.Sum}");
    }
}
return 0;

record Row(int Day, int User, string Country, int Amount, int I);
record Chunk(int Bytes, int Min, int Max);
record Group(List<Row> Rows, Dictionary<string, Chunk> Chunks);
record File(List<Group> Groups, int Footer);
record Result(int Bytes, int Sum, int Read, int Total);
