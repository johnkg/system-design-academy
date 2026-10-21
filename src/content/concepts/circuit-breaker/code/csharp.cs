// A circuit breaker in C# with closed, open and half-open states. The clock is passed in so the demo is deterministic.
using System;
using System.Threading.Tasks;

public static class Program
{
    const int FailureThreshold = 3;  // consecutive failures that open the breaker
    const long CooldownMs = 5000;    // how long it stays open before a half-open probe
    const long AfterCooldownMs = 6000; // demo time once the cooldown has passed

    public static async Task Main()
    {
        long time = 0; // milliseconds, moved by hand
        var paymentApiIsUp = false;
        var realCalls = 0;
        Task<string> Payment()
        {
            realCalls++;
            if (!paymentApiIsUp) throw new InvalidOperationException("payment API timed out");
            return Task.FromResult("charged");
        }
        var breaker = new CircuitBreaker<string>(Payment, failureThreshold: FailureThreshold, cooldownMs: CooldownMs, now: () => time);

        async Task Checkout(string label)
        {
            try { Console.WriteLine($"t={time}ms {label}: {await breaker.RunAsync()} (breaker {breaker.State})"); }
            catch (Exception e) { Console.WriteLine($"t={time}ms {label}: {e.Message} (breaker {breaker.State})"); }
        }

        foreach (var label in new[] { "c1", "c2", "c3", "c4", "c5" }) await Checkout(label); // c4 and c5 never reach the API
        time = AfterCooldownMs;
        paymentApiIsUp = true; // the provider recovered
        await Checkout("c6"); // half-open probe succeeds
        await Checkout("c7");
        Console.WriteLine($"real calls to the payment API: {realCalls}");
    }
}

public class CircuitBreaker<T>(Func<Task<T>> call, int failureThreshold, long cooldownMs, Func<long> now)
{
    private int _failures;
    private long _openedAt;
    public string State { get; private set; } = "closed";

    public async Task<T> RunAsync()
    {
        if (State == "open")
        {
            if (now() - _openedAt < cooldownMs) throw new InvalidOperationException("circuit open: failing fast");
            State = "half-open"; // cool-down over: allow a trial call
        }
        try
        {
            var result = await call();
            State = "closed"; // success (also closes from half-open)
            _failures = 0;
            return result;
        }
        catch
        {
            _failures++;
            if (State == "half-open" || _failures >= failureThreshold)
            {
                State = "open";
                _openedAt = now();
            }
            throw;
        }
    }
}
