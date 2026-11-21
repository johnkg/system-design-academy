// Flaky Tests: a 32-test suite run 200 times with a seeded generator, under four ways of dealing with flakiness.
// Look for: how many red builds are false alarms, and how many times the one REAL intermittent bug was hidden by a retry or a quarantine.
// Five suspicious tests: "reader" fails if a "writer" test left shared state just before it (order), "clock" fails near a
// minute boundary, two "sleep" tests wait a fixed time for a job that takes a variable time, and "race" is a genuine bug
// in the code under test that shows up on about 1 attempt in 20. From the outside they all look the same: they fail now and then.
using System;
using System.Linq;

public static class Program
{
    const int Tests = 32, Runs = 200, Wait = 18; // Wait: ticks a fixed sleep waits; a job takes 1 to 20 ticks

    class Gen // MINSTD generator: the same integers in every language
    {
        long s;
        public Gen(long seed) { s = seed; }
        public int Next(int n) { s = (s * 48271) % 2147483647; return (int)(s % n); }
    }

    static void Simulate(string name, int retries, bool quarantine, bool fixState, bool fixClock, bool fixPoll)
    {
        var rand = new Gen(7);
        var again = new Gen(99); // supplies the draws for retries, so the first attempts match across policies
        int red = 0, falseAlarm = 0, showed = 0, reported = 0, cost = 0;
        for (int run = 0; run < Runs; run++)
        {
            int w = rand.Next(Tests), rd0 = rand.Next(Tests - 1), rd = rd0 >= w ? rd0 + 1 : rd0;
            int[] jobs = { 1 + rand.Next(20), 1 + rand.Next(20) };
            // first attempt of each test; the draws happen whatever the policy, so policies see the same runs
            bool order = !fixState && rd > w && rd - w <= 3;
            int tick = rand.Next(60);
            bool clock = !fixClock && tick >= 58;
            bool[] sleep = jobs.Select(d => !fixPoll && d > Wait).ToArray();
            bool race = rand.Next(20) == 0;
            cost += Tests + jobs.Sum(d => fixPoll ? d : Wait);
            if (race) showed++;
            for (int attempt = 0; attempt < retries; attempt++) // only failing tests are run again
            {
                if (order) { order = false; cost += 1; }        // run alone, the state it tripped on is gone
                if (clock) { clock = !fixClock && again.Next(60) >= 58; cost += 1; }
                for (int i = 0; i < 2; i++)
                    if (sleep[i]) { int d = 1 + again.Next(20); sleep[i] = d > Wait; cost += 1 + Wait; }
                if (race) { race = again.Next(20) == 0; cost += 1; }
            }
            if (quarantine) { order = false; clock = false; sleep[0] = false; sleep[1] = false; race = false; }
            bool failed = order || clock || sleep[0] || sleep[1] || race;
            if (failed) { red++; if (!race) falseAlarm++; }
            if (race) reported++;
        }
        Console.WriteLine($"{name}: red {red}/{Runs}, false alarms {falseAlarm}, real bug showed {showed}, reported {reported}, hidden {showed - reported}, cost {cost}");
    }

    public static void Main()
    {
        Simulate("No retries, nothing fixed", 0, false, false, false, false);
        Simulate("Retry up to 2 times", 2, false, false, false, false);
        Simulate("Quarantine the flaky tests", 0, true, false, false, false);
        Simulate("Fix the causes, no retries", 0, false, true, true, true);
    }
}
