// A gateway fleet's two safety valves, in C#:
// 1) a per-consumer rate limit counted by several instances, exact or approximate, and 2) a retry budget.

const int Limit = 1000; // requests per second allowed for each consumer
const int Seed = 7, RetrySeed = 99;
const int Ticks = 100, SyncEvery = 10; // one second of 10 ms ticks; sync every 100 ms
const int AbuserRate = 30, GoodRate = 9; // requests per tick
const int Instances = 8, WideInstances = 32;
const int Requests = 1000, MaxTries = 4, RetryCost = 10, TokenCap = 200; // 1 try + 3 retries; a retry costs 10 tokens
const int FailPercent = 60;
ulong seed = Seed;
int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % (ulong)n); }

// One second in 100 ticks of 10 ms. The abuser sends 30 requests a tick (3,000 a second), a well-behaved consumer 9 (900 a second).
// The load balancer sends every request to a random instance. Returns how many requests were admitted.
(int Abuser, int WronglyRejected) Simulate(string mode, int instances)
{
    seed = Seed;
    var rates = new[] { AbuserRate, GoodRate };
    var local = new[] { new int[instances], new int[instances] };
    var seen = new[] { new int[instances], new int[instances] };
    var shared = new int[2];
    var admitted = new int[2];
    int share = Limit / instances;
    for (int tick = 0; tick < Ticks; tick++)
    {
        for (int c = 0; c < 2; c++)
        {
            if (mode == "sync" && tick % SyncEvery == 0) // every 100 ms each instance reports its count and reads the total
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
    return (admitted[0], GoodRate * Ticks - admitted[1]);
}

// Retries: a failed attempt is retried up to 3 times. With a budget, a retry costs 10 tokens and every request earns 1 token, so retries stay under 10% of requests.
(int Attempts, int Succeeded) Retries(int failPercent, bool budget)
{
    seed = RetrySeed;
    int attempts = 0, succeeded = 0, tokens = 0;
    for (int request = 0; request < Requests; request++)
    {
        tokens = Math.Min(tokens + 1, TokenCap);
        for (int tries = 0; tries < MaxTries; tries++)
        {
            if (tries > 0 && budget) { if (tokens < RetryCost) break; tokens -= RetryCost; }
            attempts++;
            if (Random(100) >= failPercent) { succeeded++; break; }
        }
    }
    return (attempts, succeeded);
}

var results = new Dictionary<string, (int Abuser, int WronglyRejected)>();
foreach (var mode in new[] { "central", "local", "split", "sync" })
{
    results[mode] = Simulate(mode, Instances);
    Console.WriteLine($"{mode.PadRight(7)} 8 instances: abuser admitted {results[mode].Abuser} of 3000 (limit {Limit}), well-behaved consumer wrongly rejected {results[mode].WronglyRejected}");
}
var wide = Simulate("split", WideInstances);
Console.WriteLine($"split   32 instances: abuser admitted {wide.Abuser}, well-behaved consumer wrongly rejected {wide.WronglyRejected}");

var unlimited = Retries(FailPercent, false);
var budgeted = Retries(FailPercent, true);
Console.WriteLine($"upstream failing 60%: unlimited retries send {unlimited.Attempts} attempts ({unlimited.Succeeded} ok), budget sends {budgeted.Attempts} attempts ({budgeted.Succeeded} ok)");

bool good = results["central"].Abuser == Limit && results["central"].WronglyRejected == 0
    && results["local"].Abuser == AbuserRate * Ticks                                            // a limit enforced per instance is no limit
    && results["split"].Abuser <= Limit && wide.WronglyRejected > 0                // an even split is safe, but rejects good traffic when counts are uneven
    && results["sync"].Abuser > Limit && results["sync"].Abuser <= Limit + AbuserRate * SyncEvery     // sync overshoots by about one interval of traffic
    && results["sync"].WronglyRejected == 0
    && budgeted.Attempts <= Requests + Requests / RetryCost && unlimited.Attempts > 2 * Requests;
if (!good) Environment.Exit(1);
