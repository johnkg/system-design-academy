// Without the pattern: every component makes its own AppConfig.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var header = new AppConfig();
        header.Set("theme", "dark");

        var footer = new AppConfig(); // a second, separate object
        Console.WriteLine(footer.Get("theme") ?? "undefined"); // the footer never saw the change
        Console.WriteLine(ReferenceEquals(header, footer));    // False
    }
}

public class AppConfig
{
    private readonly Dictionary<string, string> _settings = new();
    public void Set(string key, string value) => _settings[key] = value;
    public string? Get(string key) => _settings.GetValueOrDefault(key);
}
