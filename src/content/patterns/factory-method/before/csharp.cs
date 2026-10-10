// Without the pattern: the planner decides and builds the transport itself.
using System;

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Planner.PlanDelivery("road", "40 crates"));
        Console.WriteLine(Planner.PlanDelivery("sea", "40 crates"));
    }
}

public class Truck { public string Deliver(string cargo) => $"Truck delivers {cargo} by road"; }
public class Ship { public string Deliver(string cargo) => $"Ship delivers {cargo} by sea"; }

public static class Planner
{
    public static string PlanDelivery(string kind, string cargo)
    {
        // Knows every concrete class. Want air delivery? Edit this method,
        // and every other place with this switch.
        return kind switch
        {
            "road" => new Truck().Deliver(cargo),
            "sea" => new Ship().Deliver(cargo),
            _ => throw new ArgumentException($"Unknown delivery kind: {kind}"),
        };
    }
}
