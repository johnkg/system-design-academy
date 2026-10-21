// A volume check with a seasonality-aware baseline, and a circuit breaker, in C#:
// a table's hourly row count is compared with the same hour of the week in earlier weeks, using median and MAD (integers only).
using System;
using System.Linq;

const int HoursPerWeek = 168, Weeks = 5, HoursPerDay = 24, DaysPerWeek = 7;
const int WeekendFirstDay = 5, WeekendPercent = 40; // days 5 and 6 are the weekend
const int NoiseMinPerMille = 950, NoiseSteps = 101, PerMille = 1000; // a factor of 0.950..1.050
// Incidents in the last week: an outage on day 2, 13:00-16:00, and a double load on day 4 at 03:00.
const int OutageDay = 2, OutageFirstHour = 13, OutageLastHour = 16, OutagePercent = 35;
// The incident: on this day and hour of the last week, a re-run job leaves four times the usual rows.
const int RerunDay = 4, RerunHour = 3, RerunFactor = 4;
const int NaiveSigmas = 3, SeasonalSigmas = 4;
// Sigma = 1.48 * MAD, at least 3% of the median.
const int MadToSigmaX100 = 148, MinSigmaPercent = 3;
const int FixedFloor = 200;
const int OpenAfter = 2, CloseAfter = 3; // breaker: alerting hours to open, healthy hours to close
const ulong Seed = 4242;
ulong seed = Seed;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
long Random(long n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (long)(seed / 65536UL) % n; }

// Rows loaded per hour (in thousands) for each hour of the day: quiet at night, busy in the afternoon.
long[] shape = { 120, 90, 70, 60, 60, 80, 150, 300, 520, 700, 820, 900, 880, 860, 900, 940, 880, 760, 600, 480, 380, 300, 220, 160 };

var series = new long[HoursPerWeek * Weeks];
var incident = new bool[series.Length];
for (int t = 0; t < series.Length; t++)
{
    int hour = t % HoursPerDay, day = t / HoursPerDay % DaysPerWeek, week = t / HoursPerWeek;
    long v = shape[hour] * (day >= WeekendFirstDay ? WeekendPercent : 100) / 100; // weekends carry 40% of the weekday volume
    v = v * (NoiseMinPerMille + Random(NoiseSteps)) / PerMille;                    // noise of about plus or minus 5%
    bool bad = false;
    if (week == Weeks - 1 && day == OutageDay && hour >= OutageFirstHour && hour <= OutageLastHour)
    {
        // A source stops sending.
        v = v * OutagePercent / 100; bad = true;
    }
    if (week == Weeks - 1 && day == RerunDay && hour == RerunHour) { v *= RerunFactor; bad = true; } // a job is re-run by mistake and loads the same rows again
    series[t] = v; incident[t] = bad;
}

long Median(long[] xs)
{
    var a = xs.OrderBy(x => x).ToArray(); int n = a.Length;
    return n % 2 == 1 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

// Naive baseline: the mean of everything, and three standard deviations (compared as squares, so no square root).
int start = HoursPerWeek * (Weeks - 1);
var history = series.Take(start).ToArray();
long mean = history.Sum() / history.Length;
long variance = history.Sum(x => (x - mean) * (x - mean)) / history.Length;
bool NaiveFlag(long x) => (x - mean) * (x - mean) > NaiveSigmas * NaiveSigmas * variance;

// Seasonal baseline: the median of the same hour of the week in the 4 earlier weeks, with a spread from the MAD.
bool SeasonalFlag(int t)
{
    var same = Enumerable.Range(1, Weeks - 1).Select(w => series[t - w * HoursPerWeek]).ToArray();
    long med = Median(same), mad = Median(same.Select(x => Math.Abs(x - med)).ToArray());
    long sigma100 = Math.Max(mad * MadToSigmaX100, med * MinSigmaPercent); // 1.48 * MAD estimates sigma, with a floor of 3% of the median (times 100)
    return Math.Abs(series[t] - med) * 100 > SeasonalSigmas * sigma100;
}

(int hit, int falseAlarm, int missed) Score(Func<int, bool> flag)
{
    int hit = 0, falseAlarm = 0, missed = 0;
    for (int t = start; t < series.Length; t++)
    {
        bool f = flag(t);
        if (f && incident[t]) hit++; else if (f) falseAlarm++; else if (incident[t]) missed++;
    }
    return (hit, falseAlarm, missed);
}
var naive = Score(t => NaiveFlag(series[t])); var fixedFloor = Score(t => series[t] < FixedFloor); var seasonal = Score(SeasonalFlag);
Console.WriteLine($"incidents: {incident.Count(b => b)}; mean {mean}, last-week low {series.Skip(start).Min()}");
Console.WriteLine($"naive: hit {naive.hit}, false alarms {naive.falseAlarm}, missed {naive.missed}");
Console.WriteLine($"fixed floor of 200: hit {fixedFloor.hit}, false alarms {fixedFloor.falseAlarm}, missed {fixedFloor.missed}");
Console.WriteLine($"seasonal: hit {seasonal.hit}, false alarms {seasonal.falseAlarm}, missed {seasonal.missed}");

// Circuit breaker: 2 alerting hours in a row open it (new hours are held back), 3 healthy hours in a row close it.
bool open = false; int badRun = 0, goodRun = 0, held = 0, opened = 0;
for (int t = start; t < series.Length; t++)
{
    if (SeasonalFlag(t)) { badRun++; goodRun = 0; } else { goodRun++; badRun = 0; }
    if (!open && badRun >= OpenAfter) { open = true; opened++; }
    else if (open && goodRun >= CloseAfter) open = false;
    if (open) held++;
}
Console.WriteLine($"breaker opened {opened} time(s), held back {held} hour(s)");
if (seasonal.hit <= naive.hit || seasonal.falseAlarm >= fixedFloor.falseAlarm || seasonal.missed > 0 || open) Environment.Exit(1);
