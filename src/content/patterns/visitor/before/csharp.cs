// Without the pattern: every operation is a method on every shape.
using System;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        IShape[] shapes = { new Circle(2), new Rectangle(3, 4) };
        Console.WriteLine(string.Join(", ", shapes.Select(s => s.Area().ToString("F2"))));
        Console.WriteLine(string.Join(", ", shapes.Select(s => s.Perimeter().ToString("F2"))));
        Console.WriteLine(string.Join(", ", shapes.Select(s => s.Describe())));
    }
}

public interface IShape { double Area(); double Perimeter(); string Describe(); } // every new operation lands here

public class Circle(double r) : IShape
{
    public double Area() => Math.PI * r * r;
    public double Perimeter() => 2 * Math.PI * r;
    public string Describe() => $"circle r={r}";
}

public class Rectangle(double w, double h) : IShape
{
    public double Area() => w * h;
    public double Perimeter() => 2 * (w + h);
    public string Describe() => $"rectangle {w}x{h}";
}
// Add a Triangle: easy. Add ToSvg(): edit the interface and every shape.
