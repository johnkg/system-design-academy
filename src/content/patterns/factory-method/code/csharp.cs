// Factory Method in C#. The abstract class declares it, subclasses implement it.
using System;

public static class Program
{
    public static void Main()
    {
        Logistics[] all = { new RoadLogistics(), new SeaLogistics() };
        foreach (var logistics in all)
            Console.WriteLine(logistics.PlanDelivery("40 crates")); // same call, different product
    }
}

public interface ITransport // Product
{
    string Deliver(string cargo);
}

public class Truck : ITransport // Concrete Product
{
    public string Deliver(string cargo) => $"Truck delivers {cargo} by road";
}

public class Ship : ITransport // Concrete Product
{
    public string Deliver(string cargo) => $"Ship delivers {cargo} by sea";
}

public abstract class Logistics // Creator
{
    protected abstract ITransport CreateTransport(); // the factory method

    public string PlanDelivery(string cargo) // shared logic, works with any ITransport
    {
        ITransport transport = CreateTransport();
        return transport.Deliver(cargo);
    }
}

public class RoadLogistics : Logistics // Concrete Creator
{
    protected override ITransport CreateTransport() => new Truck();
}

public class SeaLogistics : Logistics // Concrete Creator
{
    protected override ITransport CreateTransport() => new Ship();
}
