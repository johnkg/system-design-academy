// Composition over inheritance. Part 1 is the fragile base class: a subclass that counts the units added to an army works
// until the base class changes how addAll is implemented, while a wrapper that holds an army does not care. Part 2 composes a
// unit from parts and counts, for a game whose units may combine any movement abilities with one attack style, how many
// classes each design needs. Look for: the count changing with no edit to the subclass, and the class counts as abilities grow.
using System;
using System.Collections.Generic;
using System.Linq;

public interface IArmy { List<string> Units { get; } void Add(string u); void AddAll(string[] us); }

public class ArmyV1 : IArmy
{
    public List<string> Units { get; } = new();
    public virtual void Add(string u) => Units.Add(u);
    public virtual void AddAll(string[] us) { foreach (var u in us) Add(u); }
}
public class ArmyV2 : IArmy // "faster": AddAll no longer calls Add
{
    public List<string> Units { get; } = new();
    public virtual void Add(string u) => Units.Add(u);
    public virtual void AddAll(string[] us) => Units.AddRange(us);
}
// inheritance: counts by overriding both entry points (the same code, once per base)
public class CountingV1 : ArmyV1
{
    public int Count;
    public override void Add(string u) { Count++; base.Add(u); }
    public override void AddAll(string[] us) { Count += us.Length; base.AddAll(us); }
}
public class CountingV2 : ArmyV2
{
    public int Count;
    public override void Add(string u) { Count++; base.Add(u); }
    public override void AddAll(string[] us) { Count += us.Length; base.AddAll(us); }
}
// composition: holds an army, forwards to it, counts what it forwards
public class CountingArmy(IArmy inner)
{
    public IArmy Inner = inner; public int Count;
    public void Add(string u) { Count++; Inner.Add(u); }
    public void AddAll(string[] us) { Count += us.Length; Inner.AddAll(us); }
}

// A unit composed from parts: a list of movement behaviours and one attack behaviour.
public record Part(string Name, int Value);
public class Unit(string name, Part[] moves, Part attack)
{
    public string Describe() => $"{name}: {string.Join(", ", moves.Select(m => $"{m.Name} {m.Value}"))}; {attack.Name} {attack.Value}";
}

public static class Program
{
    static int Types(int m, int a) => ((1 << m) - 1) * a;

    public static void Main()
    {
        var us = new[] { "archer", "knight" };
        var v1 = new CountingV1(); v1.AddAll(us); var w1 = new CountingArmy(new ArmyV1()); w1.AddAll(us);
        Console.WriteLine($"base v1 (addAll calls add): inheritance added {v1.Units.Count}, counted {v1.Count}; composition added {w1.Inner.Units.Count}, counted {w1.Count}");
        var v2 = new CountingV2(); v2.AddAll(us); var w2 = new CountingArmy(new ArmyV2()); w2.AddAll(us);
        Console.WriteLine($"base v2 (addAll no longer calls add): inheritance added {v2.Units.Count}, counted {v2.Count}; composition added {w2.Inner.Units.Count}, counted {w2.Count}");

        Part walk = new("walk", 2), swim = new("swim", 3), fly = new("fly", 5), melee = new("melee", 6), ranged = new("ranged", 4);
        Console.WriteLine(new Unit("duck", new[] { walk, swim, fly }, ranged).Describe());
        Console.WriteLine(new Unit("frog", new[] { walk, swim }, melee).Describe());

        // Part 2: M movement abilities, A attack styles, and a game that needs every combination (any non-empty set of movements, one attack).
        // Single inheritance: a class gets one parent, which can supply only one behaviour; the others are written again in the class.
        var designs = new (string name, Func<int, int, (int classes, int dup, int affected, int add)> f)[]
        {
            ("deep inheritance", (m, a) => (1 + Types(m, a), a * m * (1 << (m - 1)), 1 + Types(m, a), (1 << m) * a)),
            ("composition", (m, a) => (3 + m + a, 0, 1, 1)),                 // Unit, 2 interfaces, one class per behaviour
            ("shallow inheritance plus composition", (m, a) => (5 + m + a, 0, 3, 1)), // plus 2 real subclasses of Unit
        };
        foreach (var (m, a) in new[] { (2, 2), (3, 2), (4, 2), (6, 2), (6, 4) })
        {
            Console.WriteLine($"-- {m} movement abilities, {a} attack styles: {Types(m, a)} unit types");
            foreach (var (name, f) in designs)
            {
                var r = f(m, a);
                Console.WriteLine($"  {name}: {r.classes} classes, {r.dup} copies of ability code, {r.affected} classes hit by a base change, {r.add} classes to add one ability");
            }
        }
    }
}
