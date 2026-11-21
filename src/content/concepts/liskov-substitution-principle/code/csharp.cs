// Liskov Substitution Principle: a client written against a base type's contract, run against substitutes.
// Look for: which checks each subtype fails, and why. Every subtype is accepted by the language; only behaviour tells them apart.
// Bag contract: add(x) accepts any integer; after add(x), contains(x) is true and size() grew by 1;
// remove(x) takes one x out; size() always equals adds minus removes.
using System;
using System.Collections.Generic;

public interface IReader { bool Contains(int x); int Size(); }
public interface IShape { int Area(); }

public abstract class Bag : IReader // the base type and its contract
{
    public abstract void Add(int x);
    public abstract void Remove(int x);
    public abstract bool Contains(int x);
    public abstract int Size();
}
public class ListBag : Bag // honest: keeps every item, duplicates included
{
    protected readonly List<int> Items;
    public ListBag(int[] items) { Items = new List<int>(items); }
    public override void Add(int x) { Items.Add(x); }
    public override void Remove(int x) { Items.Remove(x); }
    public override bool Contains(int x) => Items.Contains(x);
    public override int Size() => Items.Count;
}
public class DedupBag : ListBag // reused ListBag, but add ignores a value it already holds: postcondition weakened
{
    public DedupBag(int[] items) : base(items) { }
    public override void Add(int x) { if (!Items.Contains(x)) base.Add(x); }
}
public class PositiveBag : ListBag // reused ListBag, but add rejects what the base accepts: precondition strengthened
{
    public PositiveBag(int[] items) : base(items) { }
    public override void Add(int x) { if (x <= 0) throw new InvalidOperationException("only positive numbers"); base.Add(x); }
}
public class ReadOnlyBag : ListBag // reused ListBag to get the reads, then switched off the writes
{
    public ReadOnlyBag(int[] items) : base(items) { }
    public override void Add(int x) { throw new InvalidOperationException("read-only: add is not allowed"); }
}
public class ReadOnlyView : IReader // composition: holds a list, offers only reading, and does not claim to be a Bag
{
    readonly List<int> items;
    public ReadOnlyView(int[] items) { this.items = new List<int>(items); }
    public bool Contains(int x) => items.Contains(x);
    public int Size() => items.Count;
}

// Rectangle contract: setWidth and setHeight change only their own side; area is width times height.
public class Rectangle : IShape
{
    protected int W, H;
    public Rectangle(int w, int h) { W = w; H = h; }
    public virtual void SetWidth(int w) { W = w; }
    public virtual void SetHeight(int h) { H = h; }
    public int Width() => W;
    public int Area() => W * H;
}
public class InheritedSquare : Rectangle // a square "is a" rectangle, so it inherits and keeps its sides equal
{
    public InheritedSquare(int s) : base(s, s) { }
    public override void SetWidth(int w) { W = w; H = w; }
    public override void SetHeight(int h) { W = h; H = h; }
}
public class SquareShape : IShape // composition: a square with a side and an area, not claiming to be a Rectangle
{
    readonly int s;
    public SquareShape(int s) { this.s = s; }
    public int Area() => s * s;
}

public static class Program
{
    static string Fmt(object v) => v is bool b ? (b ? "true" : "false") : v.ToString()!;
    static string? Expect(object got, object want) => Fmt(got) == Fmt(want) ? null : $"got {Fmt(got)}, expected {Fmt(want)}";
    // The client: each check gets a fresh object and returns null when it holds, or why it failed.
    static string? Attempt(Func<string?> fn)
    {
        try { return fn(); } catch (Exception e) { return $"threw '{e.Message}'"; }
    }

    static readonly (string, Func<object, string?>)[] WriterChecks =
    {
        ("C1 add accepts any integer, even -1", o => { ((Bag)o).Add(-1); return null; }),
        ("C2 after add(5), contains(5)", o => { var b = (Bag)o; b.Add(5); return Expect(b.Contains(5), true); }),
        ("C3 two adds of 5 make size 2", o => { var b = (Bag)o; b.Add(5); b.Add(5); return Expect(b.Size(), 2); }),
        ("C4 add(5) then remove(5) leaves it empty", o => { var b = (Bag)o; b.Add(5); b.Remove(5); return Expect($"{b.Size()} {Fmt(b.Contains(5))}", "0 false"); }),
        ("C5 size is adds minus removes (3 adds, 1 remove)", o => { var b = (Bag)o; b.Add(1); b.Add(1); b.Add(2); b.Remove(1); return Expect(b.Size(), 2); }),
    };
    static readonly (string, Func<object, string?>)[] ReaderChecks =
    {
        ("R1 contains what it was built with", o => { var r = (IReader)o; return Expect($"{Fmt(r.Contains(3))} {Fmt(r.Contains(9))}", "true false"); }),
        ("R2 size is the number of items", o => Expect(((IReader)o).Size(), 2)),
    };
    static readonly (string, Func<object, string?>)[] RectChecks =
    {
        ("Q1 setWidth(5), setHeight(4): area is 20", o => { var r = (Rectangle)o; r.SetWidth(5); r.SetHeight(4); return Expect(r.Area(), 20); }),
        ("Q2 setHeight(4) leaves the width at 5", o => { var r = (Rectangle)o; r.SetWidth(5); r.SetHeight(4); return Expect(r.Width(), 5); }),
        ("Q3 setWidth(3) reads back as 3", o => { var r = (Rectangle)o; r.SetWidth(3); return Expect(r.Width(), 3); }),
    };
    static readonly (string, Func<object, string?>)[] ShapeChecks =
    {
        ("S1 a shape with sides of 3 has area 9", o => Expect(((IShape)o).Area(), 9)),
    };

    static void RunClient(string title, (string, Func<object, string?>)[] checks, Func<object> make, Type? mustBe, string mustName)
    {
        Console.WriteLine($"-- {title}");
        if (mustBe != null && !mustBe.IsInstanceOfType(make()))
        {
            Console.WriteLine($"   rejected: not a {mustName}, so this client cannot be given one");
            return;
        }
        int pass = 0;
        foreach (var (label, check) in checks)
        {
            var why = Attempt(() => check(make()));
            if (why == null) pass++;
            Console.WriteLine($"   {label}: {(why == null ? "pass" : "FAIL, " + why)}");
        }
        Console.WriteLine($"   {pass}/{checks.Length} checks pass");
    }

    public static void Main()
    {
        var none = new int[] { };
        Console.WriteLine("== Bag contract, writer client");
        RunClient("ListBag (honest)", WriterChecks, () => new ListBag(none), typeof(Bag), "Bag");
        RunClient("DedupBag (add ignores duplicates)", WriterChecks, () => new DedupBag(none), typeof(Bag), "Bag");
        RunClient("PositiveBag (add rejects numbers up to 0)", WriterChecks, () => new PositiveBag(none), typeof(Bag), "Bag");
        RunClient("ReadOnlyBag (inherited, add throws)", WriterChecks, () => new ReadOnlyBag(none), typeof(Bag), "Bag");
        RunClient("ReadOnlyView (composition)", WriterChecks, () => new ReadOnlyView(none), typeof(Bag), "Bag");
        Console.WriteLine("== Bag contract, reader client");
        RunClient("ReadOnlyBag (inherited)", ReaderChecks, () => new ReadOnlyBag(new[] { 3, 4 }), null, "");
        RunClient("ReadOnlyView (composition)", ReaderChecks, () => new ReadOnlyView(new[] { 3, 4 }), null, "");
        Console.WriteLine("== Rectangle contract, client of Rectangle");
        RunClient("Rectangle (honest)", RectChecks, () => new Rectangle(1, 1), typeof(Rectangle), "Rectangle");
        RunClient("InheritedSquare (setters change both sides)", RectChecks, () => new InheritedSquare(1), typeof(Rectangle), "Rectangle");
        RunClient("SquareShape (composition)", RectChecks, () => new SquareShape(1), typeof(Rectangle), "Rectangle");
        Console.WriteLine("== Shape contract, client that only asks for the area");
        RunClient("Rectangle", ShapeChecks, () => new Rectangle(3, 3), null, "");
        RunClient("InheritedSquare", ShapeChecks, () => new InheritedSquare(3), null, "");
        RunClient("SquareShape (composition)", ShapeChecks, () => new SquareShape(3), null, "");
    }
}
