// Without the pattern: every tree carries its own copy of the species data.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        const int Trees = 1000, TextureChars = 10_000;
        var trees = new List<Tree>();
        for (int i = 0; i < Trees; i++)
        {
            bool oak = i % 2 == 1;
            trees.Add(new Tree(i, i * 2, oak ? "Oak" : "Pine", oak ? "green" : "dark green", new string('x', TextureChars)));
        }
        Console.WriteLine($"{trees.Count} trees each holding its own 10,000-char texture");
        // Memory scales with the number of trees, not the number of species.
    }
}

public class Tree(int x, int y, string name, string color, string texture)
{
    public int X { get; } = x;
    public int Y { get; } = y;
    public string Name { get; } = name;
    public string Color { get; } = color;
    public string Texture { get; } = texture; // duplicated per tree
}
