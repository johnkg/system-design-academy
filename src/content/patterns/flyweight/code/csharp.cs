// Flyweight in C#. Trees share one TreeType per species.
using System;
using System.Collections.Generic;

public static class Program
{
    public const int TextureSize = 10_000; // characters in one species' texture
    const int Trees = 1000;

    public static void Main()
    {
        var forest = new Forest();
        for (int i = 0; i < Trees; i++)
            forest.Plant(i, i * 2, i % 2 == 1 ? "Oak" : "Pine", i % 2 == 1 ? "green" : "dark green");

        Console.WriteLine($"{forest.Size} trees, {TreeTypeFactory.Count} shared TreeType objects");
    }
}

public sealed class TreeType(string name, string color, string texture) // Flyweight: immutable, shared
{
    public string Name { get; } = name;
    public string Color { get; } = color;
    public string Texture { get; } = texture;
    public string Draw(int x, int y) => $"{Name} ({Color}) at {x},{y}";
}

public static class TreeTypeFactory // Flyweight Factory
{
    private static readonly Dictionary<string, TreeType> _cache = new();

    public static TreeType Get(string name, string color, string texture)
    {
        string key = $"{name}|{color}";
        if (!_cache.TryGetValue(key, out var type))
            _cache[key] = type = new TreeType(name, color, texture);
        return type;
    }

    public static int Count => _cache.Count;
}

public class Tree(int x, int y, TreeType type) // Context: extrinsic state + shared reference
{
    public string Draw() => type.Draw(x, y);
}

public class Forest // Client
{
    private readonly List<Tree> _trees = new();

    public void Plant(int x, int y, string name, string color)
    {
        var type = TreeTypeFactory.Get(name, color, new string('x', Program.TextureSize)); // created once per species
        _trees.Add(new Tree(x, y, type));
    }

    public int Size => _trees.Count;
}
