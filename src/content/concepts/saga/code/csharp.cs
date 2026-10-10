// An orchestrated saga in C#: do each step, and on failure undo the completed ones in reverse.
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

public static class Program
{
    public static async Task Main()
    {
        Console.WriteLine("--- happy path");
        Console.WriteLine("booked: " + (await TripSaga(paymentWorks: true).RunAsync() ? "true" : "false"));
        Console.WriteLine("--- payment fails");
        Console.WriteLine("booked: " + (await TripSaga(paymentWorks: false).RunAsync() ? "true" : "false"));
    }

    static Saga TripSaga(bool paymentWorks) => new(new List<Step>
    {
        new("reserve flight", () => Task.CompletedTask, () => Task.CompletedTask), // each local step can be undone
        new("reserve hotel", () => Task.CompletedTask, () => Task.CompletedTask),
        new("charge card", () => paymentWorks ? Task.CompletedTask : throw new InvalidOperationException("card declined"), () => Task.CompletedTask),
    });
}

public record Step(string Name, Func<Task> Action, Func<Task> Compensate);

public class Saga(List<Step> steps)
{
    public async Task<bool> RunAsync()
    {
        var completed = new List<Step>();
        foreach (var step in steps)
        {
            try
            {
                Console.WriteLine($"do    {step.Name}");
                await step.Action();
                completed.Add(step);
            }
            catch (Exception e)
            {
                Console.WriteLine($"FAIL  {step.Name}: {e.Message}");
                completed.Reverse(); // compensate in reverse order
                foreach (var done in completed)
                {
                    Console.WriteLine($"undo  {done.Name}");
                    await done.Compensate();
                }
                return false;
            }
        }
        return true;
    }
}
