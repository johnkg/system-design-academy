// Without the pattern: a shallow copy shares the nested list.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var template = new Enemy("Goblin", 30, new List<string> { "club" });
        var a = template.ShallowCopy(); // MemberwiseClone: the Items reference is copied, not the list
        var b = template.ShallowCopy();

        a.Items.Add("shield");
        Console.WriteLine(string.Join(", ", a.Items)); // club, shield
        Console.WriteLine(string.Join(", ", b.Items)); // club, shield  <- leaked into b (and template)
    }
}

public class Enemy(string name, int hp, List<string> items)
{
    public string Name { get; } = name;
    public int Hp { get; } = hp;
    public List<string> Items { get; } = items;
    public Enemy ShallowCopy() => (Enemy)MemberwiseClone();
}
