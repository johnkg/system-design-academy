// Proxy in C#. A virtual proxy that loads the real image lazily.
using System;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var gallery = new Gallery(new[] { "a.jpg", "b.jpg", "c.jpg" }.Select(f => (IImage)new ImageProxy(f)).ToArray());
        Console.WriteLine("Gallery ready (nothing loaded yet)");
        gallery.Show(1); // loads b.jpg
        gallery.Show(1); // already loaded: displays only
    }
}

public interface IImage // Subject
{
    void Display();
}

public class RealImage : IImage // Real Subject
{
    private readonly string _file;
    public RealImage(string file)
    {
        _file = file;
        Console.WriteLine($"Loading {file} from disk (slow)...");
    }
    public void Display() => Console.WriteLine($"Displaying {_file}");
}

public class ImageProxy(string file) : IImage // Proxy
{
    private RealImage? _real;

    public void Display()
    {
        _real ??= new RealImage(file); // create on first use only
        _real.Display();
    }
}

public class Gallery(IImage[] images) // Client
{
    public void Show(int index) => images[index].Display();
}
