// Bridge in C#. Remote (abstraction) delegates to an IDevice (implementation).
using System;

public static class Program
{
    public static void Main()
    {
        foreach (IDevice device in new IDevice[] { new Tv(), new Radio() })
        {
            var remote = new AdvancedRemote(device); // any remote works with any device
            remote.TogglePower();
            remote.VolumeUp();
            Console.WriteLine($"{device.Name}: on={device.IsEnabled} volume={device.Volume}");
            remote.Mute();
            Console.WriteLine($"{device.Name}: volume={device.Volume}");
        }
    }
}

public interface IDevice // Implementor
{
    string Name { get; }
    bool IsEnabled { get; set; }
    int Volume { get; set; }
}

public class Tv : IDevice // Concrete Implementor
{
    private int _volume = 30;
    public string Name => "TV";
    public bool IsEnabled { get; set; }
    public int Volume { get => _volume; set => _volume = Math.Clamp(value, 0, 100); }
}

public class Radio : IDevice // Concrete Implementor
{
    private int _volume = 10;
    public string Name => "Radio";
    public bool IsEnabled { get; set; }
    public int Volume { get => _volume; set => _volume = Math.Clamp(value, 0, 100); }
}

public class Remote(IDevice device) // Abstraction: holds the bridge
{
    protected IDevice Device { get; } = device;
    public void TogglePower() => Device.IsEnabled = !Device.IsEnabled;
    const int VolumeStep = 10; // one button press
    public void VolumeUp() => Device.Volume += VolumeStep;
}

public class AdvancedRemote(IDevice device) : Remote(device) // Refined Abstraction
{
    public void Mute() => Device.Volume = 0;
}
