// Retry with exponential backoff and full jitter in C#. Sleep and random are passed in so the demo is deterministic.
using System;
using System.Threading.Tasks;

public static class Program
{
    public static async Task Main()
    {
        Func<int, Task> sleep = _ => Task.CompletedTask; // a real version would wait; here we only print the chosen delay
        Func<double> fixedRandom = () => 0.5;

        // A service that fails twice with a temporary error, then works
        Task<string> Flaky(int attempt) =>
            attempt <= 2 ? throw new RetryableException("503 unavailable") : Task.FromResult($"ok on attempt {attempt}");
        Console.WriteLine(await Retry.RunAsync(Flaky, 5, fixedRandom, sleep));

        // A permanent error is not retried at all
        try { await Retry.RunAsync<string>(_ => throw new Exception("404 not found"), 5, fixedRandom, sleep); }
        catch (Exception e) { Console.WriteLine($"gave up immediately: {e.Message}"); }

        // A service that never recovers: stops after the maximum attempts
        try { await Retry.RunAsync<string>(_ => throw new RetryableException("503 unavailable"), 3, fixedRandom, sleep); }
        catch (Exception e) { Console.WriteLine($"gave up after 3 attempts: {e.Message}"); }
    }
}

public class RetryableException(string message) : Exception(message);

public static class Retry
{
    public static async Task<T> RunAsync<T>(Func<int, Task<T>> operation, int maxAttempts, Func<double> random, Func<int, Task> sleep,
        int baseMs = 100, int capMs = 2000)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await operation(attempt);
            }
            catch (RetryableException e) when (attempt < maxAttempts) // anything else, or the last attempt, is rethrown
            {
                var ceiling = Math.Min(capMs, baseMs * (1 << (attempt - 1))); // 100, 200, 400, 800 ...
                var delay = (int)(random() * ceiling);                        // full jitter: anywhere from 0 to the ceiling
                Console.WriteLine($"attempt {attempt} failed ({e.Message}); waiting {delay} ms");
                await sleep(delay);
            }
        }
    }
}
