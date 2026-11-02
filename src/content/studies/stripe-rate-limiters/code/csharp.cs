// A miniature of the limiters in Stripe's "Scaling your API with rate limiters" (2017), in C# (a teaching model, not Stripe's code):
// a token bucket per user (request rate), a cap on requests in progress, a fleet load shedder that reserves room for critical
// requests, a dark launch that only logs, and failing open when the limiter's own store breaks. Everything is deterministic.

using System;
using System.Linq;

Console.WriteLine("--- request rate limiter: bucket of 5 tokens, refilled by 2 each second");
var bucket = new TokenBucket(5, 2);
foreach (var (second, requests) in new[] { (1, 8), (2, 3) })
{
    if (second > 1) bucket.Tick();
    int allowed = Enumerable.Range(0, requests).Count(_ => bucket.Take());
    Console.WriteLine($"second {second}: {requests} requests -> {allowed} allowed, {requests - allowed} rejected with 429");
}

Console.WriteLine("--- dark launch: same burst, but the limiter only logs");
var dark = new TokenBucket(5, 2);
int wouldReject = Enumerable.Range(0, 8).Count(_ => !dark.Take());
Console.WriteLine($"second 1: 8 requests -> 8 allowed, {wouldReject} would have been rejected (logged, not enforced)");

Console.WriteLine("--- concurrent requests limiter: at most 2 in progress per user");
int inProgress = 0;
bool Start() { if (inProgress >= 2) return false; inProgress++; return true; }
var started = new[] { Start(), Start(), Start() };
Console.WriteLine($"3 slow requests at once -> {started.Count(s => s)} started, {started.Count(s => !s)} rejected with 429");
inProgress--;
Console.WriteLine($"one finishes, a new request -> {(Start() ? "started" : "rejected with 429")}");

Console.WriteLine("--- fleet usage load shedder: 10 slots, 20% kept for critical requests");
const int Slots = 10, Reserved = 2; // 20% of the slots
int used = 0;
bool Admit(bool critical)
{
    int limit = critical ? Slots : Slots - Reserved; // non-critical traffic may use only 80%
    if (used >= limit) return false;
    used++;
    return true;
}
var nonCritical = Enumerable.Range(0, 9).Select(_ => Admit(false)).ToArray();
Console.WriteLine($"9 non-critical requests (list charges) -> {nonCritical.Count(a => a)} allowed, {nonCritical.Count(a => !a)} rejected with 503");
var criticalResults = Enumerable.Range(0, 3).Select(_ => Admit(true)).ToArray();
Console.WriteLine($"3 critical requests (create charge) -> {criticalResults.Count(a => a)} allowed, {criticalResults.Count(a => !a)} rejected with 503");

Console.WriteLine("--- the limiter's own store fails");
string CheckWithStore(bool storeUp)
{
    try
    {
        if (!storeUp) throw new InvalidOperationException("store unreachable");
        return "checked normally";
    }
    catch (InvalidOperationException e)
    {
        return $"limiter error ({e.Message}), failing open: request allowed";
    }
}
Console.WriteLine($"store up -> {CheckWithStore(true)}");
Console.WriteLine($"store down -> {CheckWithStore(false)}");

class TokenBucket
{
    private readonly int capacity, refill;
    private int tokens;
    public TokenBucket(int capacity, int refill) { this.capacity = capacity; this.refill = refill; tokens = capacity; }
    public void Tick() => tokens = Math.Min(capacity, tokens + refill);
    public bool Take()
    {
        if (tokens < 1) return false;
        tokens--;
        return true;
    }
}
