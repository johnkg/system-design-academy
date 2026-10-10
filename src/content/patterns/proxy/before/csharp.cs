// Without the pattern: the gallery loads every image up front.
using System;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var images = new[] { "a.jpg", "b.jpg", "c.jpg" }.Select(f => new RealImage(f)).ToArray(); // all loaded now
        Console.WriteLine("Gallery ready (everything loaded, even photos nobody will open)");
        images[1].Display();
        // With 100 photos: 100 slow loads and 100 images in memory before the first click.
    }
}

public class RealImage
{
    private readonly string _file;
    public RealImage(string file) { _file = file; Console.WriteLine($"Loading {file} from disk (slow)..."); }
    public void Display() => Console.WriteLine($"Displaying {_file}");
}
