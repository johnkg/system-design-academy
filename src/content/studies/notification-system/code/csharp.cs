// A notification sender in C#: retries with backoff and idempotent sending.
// The provider and the waiting are simulated, so the output is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        Run("Retries only (at least once):", false);
        Run("Retries plus idempotency key:", true);
    }

    static void Run(string title, bool useKey)
    {
        Console.WriteLine(title);
        var provider = new FakeProvider(new Dictionary<string, string> { ["A"] = "fail-first", ["B"] = "lose-ack-first", ["C"] = "ok" });
        foreach (var id in new[] { "A", "B", "C" }) SendWithRetry(provider, id, useKey);
        var counts = new[] { "A", "B", "C" }.Select(id => $"{id} x{provider.Delivered.Count(d => d == id)}");
        Console.WriteLine($"  user received: {string.Join(", ", counts)}");
    }

    const int MaxAttempts = 3; // sends before the worker gives up
    static void SendWithRetry(FakeProvider provider, string id, bool useKey, int maxAttempts = MaxAttempts)
    {
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                var answer = provider.Send(id, useKey ? id : null);
                Console.WriteLine($"  {id} attempt {attempt}: {answer}");
                return;
            }
            catch (Exception e)
            {
                var delay = 100 * (1 << (attempt - 1)); // exponential backoff (jitter left out to keep output fixed)
                var next = attempt < maxAttempts ? $"; retry in {delay} ms" : "; giving up (dead letter)";
                Console.WriteLine($"  {id} attempt {attempt}: {e.Message}{next}");
            }
        }
    }
}

public class FakeProvider(Dictionary<string, string> behaviour)
{
    private readonly HashSet<string> _seenKeys = new();
    private readonly Dictionary<string, int> _attempts = new();
    public List<string> Delivered { get; } = new();

    public string Send(string id, string? idempotencyKey)
    {
        var attempt = _attempts.GetValueOrDefault(id) + 1;
        _attempts[id] = attempt;
        var how = behaviour.GetValueOrDefault(id, "ok");
        if (how == "fail-first" && attempt == 1) throw new InvalidOperationException("503 provider unavailable"); // nothing delivered
        if (idempotencyKey is not null && _seenKeys.Contains(idempotencyKey)) return "already delivered, ignored";
        Delivered.Add(id);
        if (idempotencyKey is not null) _seenKeys.Add(idempotencyKey);
        if (how == "lose-ack-first" && attempt == 1) throw new InvalidOperationException("timeout waiting for answer"); // delivered, but we never hear it
        return "accepted";
    }
}
