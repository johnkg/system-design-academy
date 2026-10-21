// A polite crawl frontier in C#:
// URLs are cleaned up so the same page is not fetched twice, and each site gets its own queue with a minimum gap between requests.
using System;
using System.Collections.Generic;
using System.Linq;

public class Frontier
{
    readonly int gap;
    readonly HashSet<string> seen = new(); // every URL ever added
    readonly Dictionary<string, Queue<string>> queues = new(); // host -> URLs waiting for that host
    readonly List<string> order = new(); // hosts in turn order, so every site gets a turn
    readonly Dictionary<string, int> nextAllowed = new(); // host -> the earliest time we may fetch from it again

    public Frontier(int gapSeconds) { gap = gapSeconds; }

    // Different spellings of one page become one string: host in lower case, no default port, no #fragment, no trailing slash.
    public static string Normalize(string raw)
    {
        var u = new Uri(raw);
        string path = u.AbsolutePath.TrimEnd('/');
        if (path == "") path = "/";
        string port = u.IsDefaultPort ? "" : ":" + u.Port;
        return $"{u.Scheme}://{u.Host}{port}{path}{u.Query}";
    }

    public static string HostOf(string url) => new Uri(url).Host;

    public void Add(string raw)
    {
        string url = Normalize(raw);
        if (!seen.Add(url)) return;
        string host = HostOf(url);
        if (!queues.ContainsKey(host)) { queues[host] = new Queue<string>(); order.Add(host); }
        queues[host].Enqueue(url);
    }

    // The next URL whose site is not being rested, or null if every site with work is waiting.
    public string? Next(int now)
    {
        foreach (var host in order.ToList())
        {
            if (queues[host].Count == 0 || nextAllowed.GetValueOrDefault(host, 0) > now) continue;
            nextAllowed[host] = now + gap;
            order.Remove(host); order.Add(host); // move this host to the back, so the others get a turn
            return queues[host].Dequeue();
        }
        return null;
    }

    public int Pending => queues.Values.Sum(q => q.Count);
}

public static class Program
{
    public static int Main()
    {
        // A tiny pretend web: every page and the links found on it, written the messy way real pages write them.
        var web = new Dictionary<string, string[]>
        {
            ["http://a.com/"] = new[] { "http://a.com/p1", "http://a.com/p2", "HTTP://B.com:80/#top", "http://c.com/" },
            ["http://a.com/p1"] = new[] { "http://a.com/", "http://a.com/p2/", "http://b.com/x" },
            ["http://a.com/p2"] = new[] { "http://a.com/p1#section", "http://c.com/y" },
            ["http://b.com/"] = new[] { "http://a.com/", "http://b.com/x", "http://b.com/y" },
            ["http://b.com/x"] = new[] { "http://b.com/" },
            ["http://b.com/y"] = new[] { "http://b.com/x" },
            ["http://c.com/"] = new[] { "http://c.com/y", "http://a.com/p1" },
            ["http://c.com/y"] = new string[0],
        };

        const int Gap = 2; // seconds between requests to one site
        const int Workers = 2; // fetches that can run at the same moment
        const int MaxSeconds = 60; // stop the crawl after this long
        var frontier = new Frontier(Gap);
        frontier.Add("http://a.com/");

        var fetched = new HashSet<string>();
        var lastTime = new Dictionary<string, int>();
        int tooSoon = 0;
        for (int t = 0; t < MaxSeconds && frontier.Pending > 0; t++)
        {
            for (int w = 0; w < Workers; w++)
            {
                var url = frontier.Next(t);
                if (url == null) break;
                if (!fetched.Add(url)) return 1; // a page fetched twice
                string host = Frontier.HostOf(url);
                if (lastTime.TryGetValue(host, out int last) && t - last < Gap) tooSoon++; // a site hit again too soon
                lastTime[host] = t;
                Console.WriteLine($"t={t.ToString().PadLeft(2)}s  fetched {url}");
                foreach (var link in web.GetValueOrDefault(url, new string[0])) frontier.Add(link); // parse the page and queue its links
            }
        }
        Console.WriteLine($"pages fetched: {fetched.Count} of {web.Count}   requests sent too soon: {tooSoon}");
        return fetched.Count != web.Count || tooSoon > 0 ? 1 : 0;
    }
}
