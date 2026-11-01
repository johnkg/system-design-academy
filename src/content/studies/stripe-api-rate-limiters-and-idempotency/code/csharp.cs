// A miniature of the ideas in Stripe's 2017 posts "Scaling your API with rate limiters" and "Designing robust and
// predictable APIs with idempotency", in C# (a teaching model, not Stripe's code):
// 1) a token bucket limits one user's request rate, 2) a load shedder keeps room for critical requests when the
// workers are short of capacity, 3) idempotency keys make a retried charge safe.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
using System;
using System.Collections.Generic;

const int BucketSize = 3; // tokens a user's bucket holds, so a burst of 3 is allowed
const int RefillPerTick = 1; // tokens added to the bucket each tick
const int ScriptRequestsPerTick = 5; // a script that has run out of control
const int ScriptTicks = 4;
const int CapacityPerTick = 10; // requests the workers can finish in one tick
const int NonCriticalLimit = 5; // the shedder lets this many non-critical requests in per tick and keeps the rest for critical ones
const int CriticalPerTick = 4; // charges arriving each tick
const int NonCriticalPerTick = 9; // requests to list old charges arriving each tick
const int Amount = 2000; // an example charge

// Request rate limiter: a token bucket. Each request takes a token, tokens drip back, an empty bucket rejects.
static int TokenBucket()
{
    Console.WriteLine("--- request rate limiter: one script sends 5 requests a tick");
    var tokens = BucketSize;
    var rejectedTotal = 0;
    for (var tick = 1; tick <= ScriptTicks; tick++)
    {
        var allowed = Math.Min(ScriptRequestsPerTick, tokens);
        tokens = Math.Min(BucketSize, tokens - allowed + RefillPerTick);
        var rejected = ScriptRequestsPerTick - allowed;
        rejectedTotal += rejected;
        Console.WriteLine($"tick {tick}: sent {ScriptRequestsPerTick}, allowed {allowed}, rejected with 429: {rejected}, tokens left {tokens}");
    }
    return rejectedTotal;
}

// Fleet usage load shedder: past its share of capacity, non-critical requests get a 503 so charges still fit.
// Without it, an overloaded tick finishes only part of every kind of request.
static int LoadShedding(bool useShedder)
{
    var nonCriticalAdmitted = useShedder ? Math.Min(NonCriticalPerTick, NonCriticalLimit) : NonCriticalPerTick;
    var load = CriticalPerTick + nonCriticalAdmitted;
    int Finished(int n) => load > CapacityPerTick ? n * CapacityPerTick / load : n;
    var chargesDone = Finished(CriticalPerTick);
    var listsDone = Finished(nonCriticalAdmitted);
    var shed = NonCriticalPerTick - nonCriticalAdmitted;
    Console.WriteLine($"{(useShedder ? "with" : "without")} the shedder: load {load} of {CapacityPerTick}, charges done {chargesDone} of {CriticalPerTick}, lists done {listsDone}, lists shed with 503: {shed}");
    return chargesDone;
}

// Idempotency: the first time a key is seen the charge happens and its result is saved; a retry gets the saved result.
static (bool Replayed, string Id) Charge(Dictionary<string, string> store, string key, List<int> ledger)
{
    if (store.TryGetValue(key, out var saved)) return (true, saved);
    ledger.Add(Amount); // the money moves once
    var id = $"ch_{ledger.Count}";
    store[key] = id;
    return (false, id);
}

static (int WithoutKeys, int WithKey) RetriedCharge()
{
    Console.WriteLine("--- idempotency keys: the answer to the first attempt is lost, so the client tries again");
    var withoutKeys = new List<int> { Amount, Amount }; // every attempt is a new charge
    Console.WriteLine($"without a key: charges made {withoutKeys.Count}, the customer pays {withoutKeys.Count * Amount}");
    var store = new Dictionary<string, string>();
    var ledger = new List<int>();
    for (var attempt = 1; attempt <= 2; attempt++)
    {
        var (replayed, id) = Charge(store, "key-1", ledger);
        Console.WriteLine($"with key-1, attempt {attempt}: {(replayed ? "replayed the saved result" : "charged")} {id}");
    }
    Console.WriteLine($"with a key: charges made {ledger.Count}, the customer pays {ledger.Count * Amount}");
    return (withoutKeys.Count, ledger.Count);
}

var scriptRejected = TokenBucket();
Console.WriteLine("--- load shedding: 4 charges and 9 list requests arrive in a tick the workers can finish 10 requests of");
var chargesWithout = LoadShedding(false);
var chargesWith = LoadShedding(true);
var (chargesNoKey, chargesWithKey) = RetriedCharge();
var ok = scriptRejected == 14 && chargesWithout < CriticalPerTick && chargesWith == CriticalPerTick && chargesNoKey == 2 && chargesWithKey == 1;
Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
if (!ok) Environment.Exit(1);
