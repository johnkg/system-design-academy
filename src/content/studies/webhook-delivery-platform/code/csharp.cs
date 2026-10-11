// A webhook sender in C#: signed payloads (with a rotation window), a queue per endpoint with a
// concurrency limit, exponential backoff with jitter, and a circuit breaker, so a dead endpoint cannot hurt the others.
using System.Security.Cryptography;
using System.Text;

// The signature covers the timestamp and the exact body, so a captured request cannot be replayed later or edited.
static string Sign(string secret, long ts, string body) =>
    Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{ts}.{body}"))).ToLowerInvariant();

static bool Verify(string secret, string header, long ts, string body, long now, long tolerance = 300)
{
    if (Math.Abs(now - ts) > tolerance) return false;                        // too old (or from the future)
    string want = Sign(secret, ts, body);
    return header.Split(',').Any(sig => CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(sig), Encoding.ASCII.GetBytes(want))); // any listed signature may match
}

const int Limit = 2, MaxAttempts = 6, Trip = 3, Cool = 20, End = 200;
const long Epoch = 1700000000;
uint seed = 7;
int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }
int Backoff(int attempt) => 1 + Rnd(Math.Min(30, 2 * (1 << (attempt - 1))));   // full jitter: anywhere from 1 to the cap

// The customer side. A receiver stores event ids, so a repeated delivery is ignored instead of processed twice.
string[] rotation = { "whsec_new", "whsec_old" };   // while a secret is rotated the sender signs with both
string BodyOf(int id) => "{\"id\":\"evt_" + id + "\",\"type\":\"invoice.paid\",\"n\":" + id + "}";
string Lower(bool b) => b ? "true" : "false";

var endpoints = new List<Endpoint>
{
    new("healthy", "whsec_new", (id, attempt) => "ok"),
    new("flaky", "whsec_old", (id, attempt) => attempt > 1 ? "ok" : id % 2 == 0 ? "error" : id % 3 == 0 ? "lost" : "ok"),
    new("dead", "whsec_new", (id, attempt) => "hang"),
};

string Receive(Endpoint ep, int id, int attempt, long ts, string body, string header)
{
    if (!Verify(ep.Secret, header, ts, body, ts)) return "error";
    string how = ep.Act(id, attempt);
    if (how == "ok" || how == "lost") { if (!ep.Seen.Add(id)) ep.Dupes++; }   // 'lost' = processed, but the answer never arrived
    return how;
}

foreach (var ep in endpoints) for (int id = 1; id <= 10; id++) ep.Queue.Add(new Job { Id = id });   // fan-out: one job per endpoint

for (int t = 0; t < End; t++)
{
    foreach (var ep in endpoints)                       // each endpoint has its own queue and its own limit
    {
        if (ep.OpenUntil > t) continue;                 // breaker open: do not call it at all
        int slots = ep.Fails >= Trip ? 1 : Limit;       // half-open: a single probe
        foreach (var job in ep.Queue.Where(j => j.ReadyAt <= t).ToList())
        {
            if (slots-- == 0) break;
            job.Attempts++; ep.Attempts++;
            long ts = Epoch + t; string body = BodyOf(job.Id);
            string header = string.Join(",", rotation.Select(s => Sign(s, ts, body)));
            if (Receive(ep, job.Id, job.Attempts, ts, body, header) == "ok") { ep.Queue.Remove(job); ep.Delivered++; ep.Last = t; ep.Fails = 0; }
            else
            {
                if (++ep.Fails >= Trip) { ep.OpenUntil = t + Cool; ep.Opened++; }
                if (job.Attempts >= MaxAttempts) { ep.Queue.Remove(job); ep.Dropped++; }
                else job.ReadyAt = t + Backoff(job.Attempts);
            }
        }
    }
}

string b = BodyOf(1), good = Sign("whsec_demo", Epoch, b);
Console.WriteLine($"signature: {good[..16]}");
bool[] checks = { Verify("whsec_demo", good, Epoch, b, Epoch + 10), Verify("whsec_demo", good, Epoch, b.Replace("1", "9"), Epoch + 10), Verify("whsec_demo", good, Epoch, b, Epoch + 3600) };
Console.WriteLine($"valid: {Lower(checks[0])}, edited body: {Lower(checks[1])}, stale timestamp: {Lower(checks[2])}");
foreach (var ep in endpoints)
    Console.WriteLine($"{ep.Name}: delivered {ep.Delivered}, attempts {ep.Attempts}, dropped {ep.Dropped}, waiting {ep.Queue.Count}, duplicates ignored {ep.Dupes}, breaker opened {ep.Opened}, last delivery at {ep.Last}");

var (h, f, d) = (endpoints[0], endpoints[1], endpoints[2]);
bool fine = checks[0] && !checks[1] && !checks[2] && h.Delivered == 10 && h.Last <= 5 && h.Attempts == 10 && f.Delivered == 10 && f.Seen.Count == 10 && f.Dupes > 0 &&
    d.Delivered == 0 && d.Attempts < 10 * MaxAttempts && d.Delivered + d.Dropped + d.Queue.Count == 10;
Console.WriteLine($"dead endpoint saw {d.Attempts} attempts, not {10 * MaxAttempts}; healthy finished by tick {h.Last}");
if (!fine) Environment.Exit(1);

class Job { public int Id, Attempts, ReadyAt; }
class Endpoint(string name, string secret, Func<int, int, string> act)
{
    public string Name = name, Secret = secret; public Func<int, int, string> Act = act;
    public List<Job> Queue = new(); public HashSet<int> Seen = new();
    public int Dupes, Delivered, Attempts, Dropped, Last, Fails, OpenUntil, Opened;
}
