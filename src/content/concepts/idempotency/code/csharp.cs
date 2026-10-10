// Idempotency keys in C#: repeated requests with the same key run the work only once.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var api = new PaymentApi();

        Console.WriteLine("--- without reusing the key: the retry becomes a second payment");
        api.Charge("attempt-1", 50);
        api.Charge("attempt-2", 50); // the app made a new key on retry
        Console.WriteLine($"charges: [{string.Join(",", api.Charges)}] total ${api.Charges.Sum()}");

        var fresh = new PaymentApi();
        Console.WriteLine("--- reusing the key: the retry is a replay");
        Console.WriteLine(fresh.Charge("abc-123", 50));
        Console.WriteLine(fresh.Charge("abc-123", 50)); // the response was lost, so the client retries with the same key
        Console.WriteLine($"charges: [{string.Join(",", fresh.Charges)}] total ${fresh.Charges.Sum()}");

        try { fresh.Charge("abc-123", 80); }
        catch (Exception e) { Console.WriteLine($"rejected: {e.Message}"); }
    }
}

public record Response(string Status, int Amount, bool Replayed)
{
    public override string ToString() => $"{{ status: {Status}, amount: {Amount}, replayed: {(Replayed ? "true" : "false")} }}";
}

public class PaymentApi
{
    private readonly Dictionary<string, Response> _seen = new(); // key -> saved response
    public List<int> Charges { get; } = new();

    public Response Charge(string key, int amount)
    {
        if (_seen.TryGetValue(key, out var existing))
        {
            // same key, different body: a client bug, so refuse instead of guessing
            if (existing.Amount != amount) throw new InvalidOperationException($"key {key} was already used with a different amount");
            return existing with { Replayed = true };
        }
        // In a real system, "check the key" and "do the work" must be one atomic step
        // (a database transaction or a unique constraint), or two simultaneous requests could both pass.
        Charges.Add(amount);
        var response = new Response("charged", amount, false);
        _seen[key] = response;
        return response;
    }
}
