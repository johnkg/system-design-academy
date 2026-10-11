// A gateway fleet's two safety valves, in C#:
// 1) a per-consumer rate limit counted by several instances, exact or approximate, and 2) a retry budget.

const int Limit = 1000; // requests per second allowed for each consumer
ulong seed = 7;
int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % (ulong)n); }

// One second in 100 ticks of 10 ms. The abuser sends 30 requests a tick (3,000 a second), a well-behaved consumer 9 (900 a second).
// The load balancer sends every request to a random instance. Returns how many requests were admitted.
(int Abuser, int WronglyRejected) Simulate(string mode, int instances)
{
    seed = 7;
    var rates = new[] { 30, 9 };
    var local = new[] { new int[instances], new int[instances] };
    var seen = new[] { new int[instances], new int[instances] };
    var shared = new int[2];
    var admitted = new int[2];
    int share = Limit / instances;
    for (int tick = 0; tick < 100; tick++)
    {
        for (int c = 0; c < 2; c++)
        {
            if (mode == "sync" && tick % 10 == 0) // every 100 ms each instance reports its count and reads the total
            {
                for (int i = 0; i < instances; i++) { shared[c] += local[c][i]; local[c][i] = 0; }
                Array.Fill(seen[c], shared[c]);
            }
            for (int r = 0; r < rates[c]; r++)
            {
                int i = Random(instances);
                bool ok = mode switch
                {
                    "central" => shared[c] < Limit,                // one atomic counter in the shared store
                    "local" => local[c][i] < Limit,                // every instance enforces the whole limit alone
                    "split" => local[c][i] < share,                // every instance gets an equal share
                    _ => seen[c][i] + local[c][i] < Limit,         // sync: the last known total plus what I added since
                };
                if (!ok) continue;
                if (mode == "central") shared[c]++; else local[c][i]++;
                admitted[c]++;
            }
        }
    }
    return (admitted[0], 900 - admitted[1]);
}

// Retries: a failed attempt is retried up to 3 times. With a budget, a retry costs 10 tokens and every request earns 1 token, so retries stay under 10% of requests.
(int Attempts, int Succeeded) Retries(int failPercent, bool budget)
{
    seed = 99;
    int attempts = 0, succeeded = 0, tokens = 0;
    for (int request = 0; request < 1000; request++)
    {
        tokens = Math.Min(tokens + 1, 200);
        for (int tries = 0; tries < 4; tries++)
        {
            if (tries > 0 && budget) { if (tokens < 10) break; tokens -= 10; }
            attempts++;
            if (Random(100) >= failPercent) { succeeded++; break; }
        }
    }
    return (attempts, succeeded);
}

var results = new Dictionary<string, (int Abuser, int WronglyRejected)>();
foreach (var mode in new[] { "central", "local", "split", "sync" })
{
    results[mode] = Simulate(mode, 8);
    Console.WriteLine($"{mode.PadRight(7)} 8 instances: abuser admitted {results[mode].Abuser} of 3000 (limit {Limit}), well-behaved consumer wrongly rejected {results[mode].WronglyRejected}");
}
var wide = Simulate("split", 32);
Console.WriteLine($"split   32 instances: abuser admitted {wide.Abuser}, well-behaved consumer wrongly rejected {wide.WronglyRejected}");

var unlimited = Retries(60, false);
var budgeted = Retries(60, true);
Console.WriteLine($"upstream failing 60%: unlimited retries send {unlimited.Attempts} attempts ({unlimited.Succeeded} ok), budget sends {budgeted.Attempts} attempts ({budgeted.Succeeded} ok)");

bool good = results["central"].Abuser == Limit && results["central"].WronglyRejected == 0
    && results["local"].Abuser == 3000                                              // a limit enforced per instance is no limit
    && results["split"].Abuser <= Limit && wide.WronglyRejected > 0                // an even split is safe, but rejects good traffic when counts are uneven
    && results["sync"].Abuser > Limit && results["sync"].Abuser <= Limit + 300     // sync overshoots by about one interval of traffic
    && results["sync"].WronglyRejected == 0
    && budgeted.Attempts <= 1100 && unlimited.Attempts > 2000;
if (!good) Environment.Exit(1);
