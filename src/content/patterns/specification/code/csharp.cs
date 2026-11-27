// Specification in C#. A rule is an object that can be combined with And, Or and Not.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var active = new Leaf("active", c => c.Active);
        var blocked = new Leaf("blocked", c => c.Blocked);
        Spec TotalAtLeast(int n) => new Leaf($"total >= {n}", c => c.Total >= n);

        var customers = new List<Customer>
        {
            new("ada", true, false, 120), new("bob", true, true, 200),
            new("cy", false, false, 150), new("dee", true, false, 60),
        };

        void Report(string title, Spec rule)
        {
            var yes = customers.Where(rule.IsSatisfiedBy).Select(c => c.Name);
            var no = customers.Where(c => !rule.IsSatisfiedBy(c)).Select(c => c.Name);
            Console.WriteLine($"{title}: {rule.Describe()}");
            Console.WriteLine($"  Eligible: {string.Join(", ", yes)}");
            Console.WriteLine($"  Not eligible: {string.Join(", ", no)}");
        }

        Report("Discount rule", active.And(blocked.Not()).And(TotalAtLeast(100)));
        Report("Login rule", active.And(blocked.Not()));
    }
}

public record Customer(string Name, bool Active, bool Blocked, int Total);

public abstract class Spec // Specification
{
    public abstract bool IsSatisfiedBy(Customer customer);
    public abstract string Describe();
    public Spec And(Spec other) => new AndSpec(this, other);
    public Spec Or(Spec other) => new OrSpec(this, other);
    public Spec Not() => new NotSpec(this);
}

public class Leaf(string text, Func<Customer, bool> test) : Spec // Leaf specification: one simple condition
{
    public override bool IsSatisfiedBy(Customer c) => test(c);
    public override string Describe() => text;
}

public class AndSpec(Spec left, Spec right) : Spec // Composite specification
{
    public override bool IsSatisfiedBy(Customer c) => left.IsSatisfiedBy(c) && right.IsSatisfiedBy(c);
    public override string Describe() => $"({left.Describe()} AND {right.Describe()})";
}

public class OrSpec(Spec left, Spec right) : Spec
{
    public override bool IsSatisfiedBy(Customer c) => left.IsSatisfiedBy(c) || right.IsSatisfiedBy(c);
    public override string Describe() => $"({left.Describe()} OR {right.Describe()})";
}

public class NotSpec(Spec inner) : Spec
{
    public override bool IsSatisfiedBy(Customer c) => !inner.IsSatisfiedBy(c);
    public override string Describe() => $"NOT {inner.Describe()}";
}
