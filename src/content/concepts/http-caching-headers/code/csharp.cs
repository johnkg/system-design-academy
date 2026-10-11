// A tiny HTTP cache that applies Cache-Control and ETag rules to a scripted request sequence.
// Time is an integer number of seconds passed in by hand, so the output is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

var origin = new Origin();
var cache = new Cache(origin);
var counts = new Dictionary<string, int> { ["hit"] = 0, ["swr"] = 0, ["revalidated"] = 0, ["refetched"] = 0, ["miss"] = 0 };
int staleViews = 0;
var script = new (int t, string url)[] {
    (0, "/app.js"), (0, "/index.html"), (0, "/me"), (0, "/app.3f9a.js"), (30, "/app.js"), (40, "/me"),
    (50, "/index.html"), (61, "/app.js"), (80, "/me"), (100, "/app.js"), (120, "/index.html"),
    (121, "/app.js"), (130, "/app.js"), (150, "/index.html"), (200, "/app.3f9a.js"), (300, "/app.js"),
    (100000, "/app.3f9a.js") };
foreach (var (t, url) in script)
{
    var (outcome, age, ver) = cache.Get(url, t);
    bool stale = ver < origin.Version(url, t);
    if (stale) staleViews++;
    counts[outcome]++;
    Console.WriteLine($"t={t} {url} {outcome} age={age} v{ver}{(stale ? " STALE" : "")}");
}
Console.WriteLine($"hit={counts["hit"]} swr={counts["swr"]} revalidated={counts["revalidated"]} refetched={counts["refetched"]} miss={counts["miss"]} origin={origin.Requests} stale={staleViews}");

void Check(bool ok, string what) { if (!ok) { Console.Error.WriteLine("invariant failed: " + what); Environment.Exit(1); } }
Check(counts.Values.Sum() == script.Length, "every request has one outcome");
Check(origin.Requests == counts["miss"] + counts["revalidated"] + counts["refetched"] + counts["swr"], "origin requests");
Check(!cache.Store.ContainsKey("/me") && counts["miss"] == 6, "no-store is never stored");
Check(counts["hit"] == 5 && counts["swr"] == 2 && counts["revalidated"] == 3 && counts["refetched"] == 1, "outcome counts");
Check(staleViews == 2, "stale views after the deploy");

static class CacheControl
{
    public static Dictionary<string, int> Parse(string header)
    {
        var d = new Dictionary<string, int>();
        foreach (var raw in header.Split(','))
        {
            var part = raw.Trim();
            if (part.Length == 0) continue;
            int i = part.IndexOf('=');
            if (i < 0) d[part] = 1;
            else d[part.Substring(0, i)] = int.Parse(part.Substring(i + 1));
        }
        return d;
    }
}

class Entry { public string Cc = ""; public string Etag = ""; public int Ver; public int Stored; }

class Origin
{
    static readonly Dictionary<string, string> Cc = new() {
        ["/app.js"] = "max-age=60, stale-while-revalidate=30", ["/index.html"] = "no-cache",
        ["/me"] = "no-store", ["/app.3f9a.js"] = "max-age=31536000, immutable" };
    static readonly Dictionary<string, int> ChangesAt = new() { ["/app.js"] = 100, ["/index.html"] = 110 }; // a deploy: v1 becomes v2
    public int Requests;

    public int Version(string url, int now) => now >= (ChangesAt.TryGetValue(url, out var c) ? c : 1000000000) ? 2 : 1;

    public (int status, string cc, string etag, int ver) Handle(string url, int now, string? ifNoneMatch)
    {
        Requests++;
        int ver = Version(url, now);
        string etag = $"\"v{ver}\"";
        return ifNoneMatch == etag ? (304, Cc[url], etag, 0) : (200, Cc[url], etag, ver);
    }
}

class Cache
{
    public readonly Dictionary<string, Entry> Store = new();
    readonly Origin origin;
    public Cache(Origin o) { origin = o; }

    (int status, int ver) Fetch(string url, int now, string? etag)
    {
        var (status, cc, newEtag, ver) = origin.Handle(url, now, etag);
        if (status == 304) Store[url].Stored = now; // unchanged: keep the body, restart its age
        else if (!CacheControl.Parse(cc).ContainsKey("no-store")) Store[url] = new Entry { Cc = cc, Etag = newEtag, Ver = ver, Stored = now }; // no-store: never write it
        return (status, ver);
    }

    public (string outcome, int age, int ver) Get(string url, int now)
    {
        if (!Store.TryGetValue(url, out var e)) return ("miss", 0, Fetch(url, now, null).ver);
        var cc = CacheControl.Parse(e.Cc);
        int age = now - e.Stored;
        int life = cc.ContainsKey("no-cache") ? 0 : cc.GetValueOrDefault("max-age", 0);
        if (age < life) return ("hit", age, e.Ver);
        if (!cc.ContainsKey("no-cache") && age < life + cc.GetValueOrDefault("stale-while-revalidate", 0))
        {
            int staleVer = e.Ver;
            Fetch(url, now, e.Etag); // background refresh, the caller does not wait
            return ("swr", age, staleVer);
        }
        var (status, ver) = Fetch(url, now, e.Etag);
        return status == 304 ? ("revalidated", 0, e.Ver) : ("refetched", 0, ver);
    }
}
