// Visitor in C#. Operations live in visitors; shapes only know Accept().
using System;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        IShape[] shapes = { new Circle(2), new Rectangle(3, 4) };
        Console.WriteLine("Area: " + string.Join(", ", shapes.Select(s => s.Accept(new AreaVisitor()))));
        Console.WriteLine("Perimeter: " + string.Join(", ", shapes.Select(s => s.Accept(new PerimeterVisitor()))));
        Console.WriteLine("Describe: " + string.Join(", ", shapes.Select(s => s.Accept(new DescribeVisitor()))));
    }
}

public interface IShapeVisitor<T> // Visitor
{
    T VisitCircle(Circle c);
    T VisitRectangle(Rectangle r);
}

public interface IShape // Element
{
    T Accept<T>(IShapeVisitor<T> visitor);
}

public class Circle(double radius) : IShape // Concrete Element
{
    public double Radius { get; } = radius;
    public T Accept<T>(IShapeVisitor<T> visitor) => visitor.VisitCircle(this); // double dispatch
}

public class Rectangle(double width, double height) : IShape // Concrete Element
{
    public double Width { get; } = width;
    public double Height { get; } = height;
    public T Accept<T>(IShapeVisitor<T> visitor) => visitor.VisitRectangle(this);
}

public class AreaVisitor : IShapeVisitor<string> // Concrete Visitor
{
    public string VisitCircle(Circle c) => (Math.PI * c.Radius * c.Radius).ToString("F2");
    public string VisitRectangle(Rectangle r) => (r.Width * r.Height).ToString("F2");
}

public class PerimeterVisitor : IShapeVisitor<string> // Concrete Visitor
{
    public string VisitCircle(Circle c) => (2 * Math.PI * c.Radius).ToString("F2");
    public string VisitRectangle(Rectangle r) => (2 * (r.Width + r.Height)).ToString("F2");
}

public class DescribeVisitor : IShapeVisitor<string> // A brand new operation: shapes were not touched
{
    public string VisitCircle(Circle c) => $"circle r={c.Radius}";
    public string VisitRectangle(Rectangle r) => $"rectangle {r.Width}x{r.Height}";
}
