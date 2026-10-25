// A calendar core in C#: a weekly series stored once as a rule in wall time plus a time zone, expanded only inside the
// window a reader asks for (with a cancelled and a moved occurrence), free/busy by merging busy intervals, and a room that
// rejects overlapping bookings the way an exclusion constraint does. Times are whole minutes since 1970-01-01 UTC.
using System;
using System.Collections.Generic;
using System.Linq;

public record Zone(long Std, long Dst, Func<long, (long Start, long End)> Range);
public record Instance(long Start, long End, bool Moved);
public record Booking(string Who, long Start, long End);

public static class Program
{
    const long Day = 1440, Hour = 60;

    // Calendar arithmetic on day numbers (days since 1970-01-01), so no library or machine time zone is involved.
    static long DaysFromCivil(long y, long m, long d)
    {
        y -= m <= 2 ? 1 : 0;
        long era = y / 400, yoe = y - era * 400;
        long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        return era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    }
    static (long Y, long M, long D) CivilFromDays(long z)
    {
        z += 719468;
        long era = z / 146097, doe = z - era * 146097;
        long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        long mp = (5 * doy + 2) / 153, d = doy - (153 * mp + 2) / 5 + 1, m = mp + (mp < 10 ? 3 : -9);
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d);
    }
    static long Weekday(long days) => (days + 4) % 7; // 0 = Sunday; 1970-01-01 was a Thursday
    static long NthSunday(long y, long m, long n) { long first = DaysFromCivil(y, m, 1); return first + (7 - Weekday(first)) % 7 + 7 * (n - 1); }
    static long LastSunday(long y, long m) { long last = DaysFromCivil(y, m + 1, 1) - 1; return last - Weekday(last); }

    // Two zones with today's rules: the start and end of summer time as UTC instants for a given year.
    static readonly Dictionary<string, Zone> Zones = new()
    {
        // second Sunday of March 02:00 local to first Sunday of November 02:00 local
        ["America/New_York"] = new Zone(-5 * Hour, -4 * Hour, y => (NthSunday(y, 3, 2) * Day + 7 * Hour, NthSunday(y, 11, 1) * Day + 6 * Hour)),
        // last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC
        ["Europe/London"] = new Zone(0, Hour, y => (LastSunday(y, 3) * Day + Hour, LastSunday(y, 10) * Day + Hour)),
    };
    static long OffsetAt(string zone, long utc)
    {
        var z = Zones[zone];
        var (start, end) = z.Range(CivilFromDays(utc / Day).Y);
        return utc >= start && utc < end ? z.Dst : z.Std;
    }
    // Wall time to UTC. A time that happens twice means the first one; a time skipped by the clock change is read with the
    // offset from before the gap, so it lands one hour later (both as RFC 5545 says).
    static long ToUtc(string zone, long local)
    {
        var z = Zones[zone];
        foreach (var off in new[] { z.Dst, z.Std }) if (OffsetAt(zone, local - off) == off) return local - off;
        return local - z.Std;
    }
    static string Date(long t) { var (y, m, d) = CivilFromDays(t / Day); return $"{y}-{m:D2}-{d:D2}"; }
    static string Clock(long t) { long m = ((t % Day) + Day) % Day; return $"{m / Hour:D2}:{m % Hour:D2}"; }
    static long InZone(string zone, long utc) => utc + OffsetAt(zone, utc);
    static long Local(long y, long m, long d, long h, long min = 0) => DaysFromCivil(y, m, d) * Day + h * Hour + min;

    public static int Main()
    {
        // The series: stored once, never copied into rows. EXDATE cancels an occurrence; an override replaces one, keyed by its original start.
        const string SeriesZone = "America/New_York";
        long seriesStart = Local(2026, 3, 2, 9);
        const long Minutes = 60, EveryDays = 7, Count = 6;
        var exdates = new HashSet<long> { Local(2026, 3, 16, 9) };
        var overrides = new Dictionary<long, long> { [Local(2026, 3, 23, 9)] = Local(2026, 3, 23, 10) };

        // Expand only the occurrences that touch [from, to). Steps are taken in wall time, then each one is converted to UTC.
        List<Instance> Expand(long from, long to)
        {
            var output = new List<Instance>();
            for (long i = 0; i < Count; i++)
            {
                long original = seriesStart + i * EveryDays * Day;
                if (exdates.Contains(original)) continue;
                bool moved = overrides.TryGetValue(original, out var replaced);
                long start = ToUtc(SeriesZone, moved ? replaced : original), end = start + Minutes;
                if (start < to && end > from) output.Add(new Instance(start, end, moved));
            }
            return output;
        }

        Console.WriteLine("series: Mondays 09:00 America/New_York from 2026-03-02, 6 times, 2026-03-16 cancelled, 2026-03-23 moved to 10:00");
        long naiveUtc = ToUtc(SeriesZone, seriesStart); // the mistake: keep the first instant and add 7 days of UTC
        var instances = Expand(Local(2026, 3, 9, 0), Local(2026, 4, 6, 0));
        foreach (var x in instances)
        {
            long weeks = (x.Start - naiveUtc + 7 * Day / 2) / (7 * Day), wrong = naiveUtc + weeks * 7 * Day;
            string tail = x.Moved ? "moved by an override" : $"stored as one UTC instant: {Clock(InZone(SeriesZone, wrong))} in New York";
            Console.WriteLine($"{Date(x.Start)} New York {Clock(InZone(SeriesZone, x.Start))}, UTC {Clock(x.Start)}, London {Clock(InZone("Europe/London", x.Start))}; {tail}");
        }
        long gap = ToUtc("America/New_York", Local(2026, 3, 8, 2, 30));
        Console.WriteLine($"2026-03-08 02:30 does not exist in New York: read as {Clock(InZone("America/New_York", gap))} local, {Clock(gap)} UTC");

        // Free/busy on Monday 9 March: each calendar's busy intervals (UTC), merged, then gaps of at least 60 minutes in 09:00-17:00 New York.
        long day = DaysFromCivil(2026, 3, 9) * Day;
        long At(long h, long m = 0) => day + h * Hour + m;
        var busy = new Dictionary<string, List<long[]>>
        {
            ["Alice"] = instances.Where(x => x.Start < At(24)).Select(x => new[] { x.Start, x.End }).Append(new[] { At(15), At(16) }).ToList(),
            ["Ben"] = new() { new[] { At(14, 30), At(15, 30) }, new[] { At(17), At(18) } },
            ["Room 4B"] = new() { new[] { At(19), At(20) } },
        };
        var all = busy.Values.SelectMany(v => v).OrderBy(iv => iv[0]).ToList();
        var merged = new List<long[]>();
        foreach (var iv in all)
        {
            if (merged.Count > 0 && iv[0] <= merged[^1][1]) merged[^1][1] = Math.Max(merged[^1][1], iv[1]);
            else merged.Add(new[] { iv[0], iv[1] });
        }
        long workFrom = ToUtc("America/New_York", Local(2026, 3, 9, 9)), workTo = ToUtc("America/New_York", Local(2026, 3, 9, 17));
        const long Need = 60;
        var free = new List<(long S, long E)>();
        long cursor = workFrom;
        foreach (var iv in merged) { if (iv[0] - cursor >= Need) free.Add((cursor, iv[0])); cursor = Math.Max(cursor, iv[1]); }
        if (workTo - cursor >= Need) free.Add((cursor, workTo));
        string Ny(long t) => Clock(InZone("America/New_York", t));
        Console.WriteLine($"busy intervals: {all.Count}, merged: {string.Join(" ", merged.Select(iv => $"{Ny(iv[0])}-{Ny(iv[1])}"))} (New York)");
        Console.WriteLine($"free for {Need} min: {string.Join(" ", free.Select(f => $"{Ny(f.S)}-{Ny(f.E)}"))}");

        // Room 4B: three bookings arrive together. Ranges are half-open [start, end), so 11:00-12:00 does not clash with 10:00-11:00.
        long midnight = ToUtc("America/New_York", Local(2026, 3, 10, 0)); // Tuesday 10 March
        var requests = new[] { ("Dana", 600L, 660L), ("Eli", 630L, 690L), ("Fay", 660L, 720L) }
            .Select(r => new Booking(r.Item1, midnight + r.Item2, midnight + r.Item3)).ToList();
        static bool Overlaps(Booking a, Booking b) => a.Start < b.End && b.Start < a.End;
        // Read then write: all three check the same empty snapshot, then all insert.
        int clashes = 0;
        for (int i = 0; i < requests.Count; i++) for (int j = i + 1; j < requests.Count; j++) if (Overlaps(requests[i], requests[j])) clashes++;
        Console.WriteLine($"read then write: {requests.Count} booked, {clashes} overlapping pairs");
        // Exclusion constraint: the database checks each insert against the rows already committed, one at a time.
        var table = new List<Booking>(); var results = new List<string>();
        foreach (var r in requests)
        {
            var hit = table.FirstOrDefault(b => Overlaps(b, r));
            if (hit != null) results.Add($"{r.Who} rejected (overlaps {hit.Who})"); else { table.Add(r); results.Add($"{r.Who} booked"); }
        }
        Console.WriteLine($"exclusion constraint: {string.Join(", ", results)}");

        if (clashes == 0 || table.Count != 2 || free.Count != 3) return 1;
        return 0;
    }
}
