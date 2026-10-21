// A configuration service in C#: schema check at publish, staged rollout with a health gate,
// automatic rollback, and clients that keep a last-known-good copy when a fetch fails or is damaged.
using System;
using System.Collections.Generic;
using System.Linq;

static class H
{
    const int MinTimeoutMs = 50; // schema limits
    const int MaxTimeoutMs = 5000;
    const int MaxRetries = 5;
    public static uint Hash(string s) { uint h = 2166136261; foreach (char ch in s) h = unchecked((h ^ ch) * 16777619u); return h; }
    public static string Flat(Cfg c) => $"{c.TimeoutMs}|{c.Retries}|{c.Mode}"; // canonical text, used for the checksum
    public static string Validate(Cfg c) // the schema: type and range for every key
    {
        if (c.TimeoutMs < MinTimeoutMs || c.TimeoutMs > MaxTimeoutMs) return "timeout_ms must be 50..5000";
        if (c.Retries < 0 || c.Retries > MaxRetries) return "retries must be 0..5";
        if (c.Mode != "fast" && c.Mode != "safe") return "mode must be fast or safe";
        return "ok";
    }
    public static string Js(bool b) => b ? "true" : "false";
}

record Cfg(int TimeoutMs, int Retries, string Mode);
record Reply(int Version, Cfg Config, uint Sum);

class ConfigService
{
    public List<Cfg?> Versions = new() { null };
    public int Stable, Candidate, Pct;
    public bool Down;

    public string Publish(Cfg cfg)
    {
        string why = H.Validate(cfg);
        if (why != "ok") return $"rejected, {why}";
        Versions.Add(cfg);
        return $"ok, version {Versions.Count - 1}";
    }

    public Reply? Fetch(string clientId) // a client in the first pct buckets gets the candidate, the rest get the stable version
    {
        if (Down) return null;
        int v = H.Hash(clientId) % 100 < Pct ? Candidate : Stable;
        Cfg cfg = Versions[v]!;
        return new Reply(v, cfg with { }, H.Hash(H.Flat(cfg)));
    }
}

class Client
{
    public string Id; public int Version; public Cfg? Config;
    public Client(string id) { Id = id; }

    public string Poll(ConfigService service, bool damage = false)
    {
        Reply? r = service.Fetch(Id);
        if (r == null) return "kept";
        Cfg cfg = damage ? r.Config with { TimeoutMs = r.Config.TimeoutMs + 1 } : r.Config; // simulate a corrupted payload
        if (H.Hash(H.Flat(cfg)) != r.Sum || H.Validate(cfg) != "ok") return "kept"; // last-known-good stays
        Version = r.Version; Config = cfg;
        return "applied";
    }

    public bool Failing() => Config != null && Config.TimeoutMs < 100; // too short a timeout fails every call
}

static class Program
{
    static bool Rollout(ConfigService service, List<Client> clients, int version, int[] stages, int limit)
    {
        service.Candidate = version;
        foreach (int pct in stages)
        {
            service.Pct = pct;
            clients.ForEach(c => c.Poll(service));
            int errors = clients.Count(c => c.Failing());
            Console.WriteLine($"  v{version} at {pct}%: {clients.Count(c => c.Version == version)} clients, {errors} failing");
            if (errors > limit)
            {
                service.Pct = 0; clients.ForEach(c => c.Poll(service));
                Console.WriteLine($"  rolled back, {clients.Count(c => c.Failing())} failing");
                return false;
            }
        }
        service.Stable = version; service.Pct = 0;
        clients.ForEach(c => c.Poll(service));
        return true;
    }

    const int Clients = 1000;
    const int ErrorLimit = 10; // failed clients a stage may have before rollback
    static int Main()
    {
        var svc = new ConfigService();
        var clients = Enumerable.Range(0, Clients).Select(i => new Client($"c{i}")).ToList();
        Console.WriteLine("publish v1: " + svc.Publish(new Cfg(800, 2, "safe")));
        svc.Stable = 1; clients.ForEach(c => c.Poll(svc));
        Console.WriteLine("publish v2: " + svc.Publish(new Cfg(500, 3, "fast")));
        Console.WriteLine("publish bad: " + svc.Publish(new Cfg(900, 9, "fast")));
        Console.WriteLine("publish v3: " + svc.Publish(new Cfg(60, 1, "fast")));
        int[] stages = { 5, 25, 100 }; // percent of clients at each step
        bool ok2 = Rollout(svc, clients, 2, stages, ErrorLimit);
        bool ok3 = Rollout(svc, clients, 3, stages, ErrorLimit);
        int onV2 = clients.Count(c => c.Version == 2);

        svc.Down = true; // the service is unreachable, so every client keeps what it has
        int kept = clients.Count(c => c.Poll(svc) == "kept");
        svc.Down = false;
        string damaged = clients[7].Poll(svc, true);
        Console.WriteLine($"outage: {kept} clients kept their copy; damaged payload: {damaged}, still v{clients[7].Version}");
        Console.WriteLine($"rollout v2: {H.Js(ok2)}, rollout v3: {H.Js(ok3)}, clients on v2: {onV2}");
        return (!ok2 || ok3 || onV2 != Clients || kept != Clients || damaged != "kept") ? 1 : 0;
    }
}
