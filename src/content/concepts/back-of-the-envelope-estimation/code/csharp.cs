// Back-of-the-envelope estimation: turn a few stated assumptions into requests per second, storage and bandwidth.
// Everything is whole-number arithmetic, so JavaScript, Python and C# print exactly the same text.
// Units are decimal (1 KB = 1,000 bytes), which is close enough for an estimate and easy to do in your head.
using System;
using System.Globalization;

public static class Program
{
    const long DailyUsers = 10_000_000;
    const long ActionsPerUserPerDay = 2; // photo uploads
    const long KbPerAction = 500; // a photo after the app compresses it
    const long PeakFactor = 3; // the busiest moment runs at about 3 times the daily average
    const long YearsKept = 1;

    const long SecondsPerDayRounded = 100_000; // rounded up from 86,400 so division is easy
    const long SecondsPerDayExact = 86_400;
    const long DaysPerYear = 365;
    const long Kilo = 1000; // each unit step (KB to MB to GB ...) is a factor of 1,000
    const long BitsPerByte = 8; // links are rated in bits per second, files are measured in bytes
    const long LinkKbps = 10_000_000; // one 10 Gbps network link, in kilobits per second
    static readonly string[] ByteUnits = { "KB", "MB", "GB", "TB", "PB", "EB" };
    static readonly string[] BitUnits = { "Kbps", "Mbps", "Gbps", "Tbps" };

    // The latency ladder in nanoseconds: rough orders of magnitude, not measurements of any one machine.
    static readonly (string Name, long Ns)[] Ladder =
    {
        ("Read from memory", 100),
        ("Random read from an SSD", 100_000),
        ("Round trip inside one data centre", 500_000),
        ("Round trip to another region", 100_000_000),
    };

    static long RoundDiv(long a, long b) => (2 * a + b) / (2 * b); // a / b rounded to the nearest whole number
    static string Commas(long n) => n.ToString("N0", CultureInfo.InvariantCulture);

    static string Human(long value, string[] units)
    {
        // Pick the largest unit that keeps the number at 1 or more, and show up to two decimals.
        int unit = 0;
        long scale = 1;
        while (unit < units.Length - 1 && value >= scale * Kilo) { scale *= Kilo; unit++; }
        long hundredths = RoundDiv(value * 100, scale);
        long whole = hundredths / 100, frac = hundredths % 100;
        string text = frac == 0 ? $"{whole}" : frac % 10 == 0 ? $"{whole}.{frac / 10}" : $"{whole}.{frac:00}";
        return $"{text} {units[unit]}";
    }

    static string Time(long ns)
    {
        if (ns >= 1_000_000) return $"{ns / 1_000_000} ms";
        if (ns >= 1_000) return $"{ns / 1_000} us";
        return $"{ns} ns";
    }

    public static void Main()
    {
        Console.WriteLine($"Assumptions: {Commas(DailyUsers)} daily users, {ActionsPerUserPerDay} actions each, {KbPerAction} KB per action, peak {PeakFactor}x, kept {YearsKept} year");

        long perDay = DailyUsers * ActionsPerUserPerDay;
        Console.WriteLine($"requests per day: {Commas(DailyUsers)} x {ActionsPerUserPerDay} = {Commas(perDay)}");

        long averageQps = RoundDiv(perDay, SecondsPerDayRounded);
        long exactQps = RoundDiv(perDay, SecondsPerDayExact);
        long roundingErrorPercent = RoundDiv(100 * (SecondsPerDayRounded - SecondsPerDayExact), SecondsPerDayRounded);
        Console.WriteLine($"average per second ({Commas(SecondsPerDayRounded)} s a day): {Commas(averageQps)}");
        Console.WriteLine($"average per second ({Commas(SecondsPerDayExact)} s a day): {Commas(exactQps)}");
        Console.WriteLine($"rounding the day costs about {roundingErrorPercent}%");

        long peakQps = averageQps * PeakFactor;
        Console.WriteLine($"peak per second: {Commas(averageQps)} x {PeakFactor} = {Commas(peakQps)}");

        long storagePerDayKb = perDay * KbPerAction;
        long storageKb = storagePerDayKb * DaysPerYear * YearsKept;
        Console.WriteLine($"storage per day: {Human(storagePerDayKb, ByteUnits)}");
        Console.WriteLine($"storage for {YearsKept} year: {Human(storageKb, ByteUnits)}");

        long peakKbPerSecond = peakQps * KbPerAction;
        long peakKbps = peakKbPerSecond * BitsPerByte;
        Console.WriteLine($"peak bandwidth: {Human(peakKbPerSecond, ByteUnits)}/s = {Human(peakKbps, BitUnits)}");
        Console.WriteLine($"share of one 10 Gbps link: {RoundDiv(100 * peakKbps, LinkKbps)}%");

        Console.WriteLine("latency ladder:");
        long memoryNs = Ladder[0].Ns;
        foreach (var (name, ns) in Ladder)
            Console.WriteLine($"  {name,-34} {Time(ns),6} = {Commas(ns / memoryNs)}x memory");
    }
}
