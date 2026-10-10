// Prototype in C#. A generic clone interface and a registry of prototypes.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var spawner = new Spawner();
        spawner.Register("goblin", new Enemy("Goblin", 30, new List<string> { "club" }));

        var a = spawner.Spawn("goblin");
        var b = spawner.Spawn("goblin");
        a.Items.Add("shield");

        Console.WriteLine(string.Join(", ", a.Items)); // club, shield
        Console.WriteLine(string.Join(", ", b.Items)); // club: unaffected, thanks to the deep copy
    }
}

public interface IPrototype<T> // Prototype
{
    T Clone();
}

public class Enemy(string name, int hp, List<string> items) : IPrototype<Enemy> // Concrete Prototype
{
    public string Name { get; } = name;
    public int Hp { get; } = hp;
    public List<string> Items { get; } = items;

    public Enemy Clone() => new(Name, Hp, new List<string>(Items)); // copy the list, do not share it
}

public class Spawner // Client with a registry of prototypes
{
    private readonly Dictionary<string, Enemy> _registry = new();
    public void Register(string key, Enemy prototype) => _registry[key] = prototype;
    public Enemy Spawn(string key) => _registry[key].Clone();
}
