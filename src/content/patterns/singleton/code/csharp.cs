// Singleton in C#. Lazy<T> makes creation thread-safe and on-demand.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var header = AppConfig.Instance; // Client
        header.Set("theme", "dark");

        var footer = AppConfig.Instance; // Client
        Console.WriteLine(footer.Get("theme"));                       // dark: same object
        Console.WriteLine(ReferenceEquals(header, footer));           // True
        // new AppConfig();  // compile error: the constructor is private
    }
}

public sealed class AppConfig // Singleton
{
    private static readonly Lazy<AppConfig> _instance = new(() => new AppConfig());
    private readonly Dictionary<string, string> _settings = new();

    private AppConfig() { } // outsiders cannot call new

    public static AppConfig Instance => _instance.Value;

    public void Set(string key, string value) => _settings[key] = value;
    public string? Get(string key) => _settings.GetValueOrDefault(key);
}
