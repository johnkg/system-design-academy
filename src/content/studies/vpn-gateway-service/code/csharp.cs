// A small VPN gateway fleet, in C#: pick a gateway by latency plus load, keep a session alive across address changes,
// detect a dead peer, drain a gateway without dropping its users, and split traffic by route.
using System;
using System.Collections.Generic;
using System.Linq;

public class Session { public int Sid, Region, Addr, LastSeq, LastSeen, Gw; public uint Key; }
public class Gateway { public int Id; public int[] Lat = Array.Empty<int>(); public bool Draining; public Dictionary<int, Session> Sessions = new(); }
public record Packet(int Sid, int Seq, int Addr, uint Tag);

public static class Fleet
{
    public const int Cap = 8;
    public static readonly int[][] Lat = { new[] { 10, 60, 120 }, new[] { 60, 10, 90 }, new[] { 120, 90, 10 }, new[] { 30, 40, 100 } }; // ms from each region
    public static readonly List<Gateway> Gateways = Lat.Select((l, i) => new Gateway { Id = i, Lat = l }).ToList();
    public const int Clients = 24, Regions = 3;
    const int LoadPenaltyMs = 60; // a full gateway counts as 60 ms further away
    const int KeySalt = 99, AddrBase = 1000; // per-session key derivation; tunnel addresses start at 1000
    const int DeadAfter = 30; // ticks of silence before a peer is dead
    const int Ipv4Bits = 32;
    const uint Seed = 7;
    static uint seed = Seed;

    public static uint Fnv(params uint[] xs) { uint h = 0x811c9dc5; foreach (var x in xs) h = unchecked((h ^ x) * 16777619u); return h; }
    public static int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 8) % (uint)n); }

    // Cost = round-trip time plus a penalty that grows with load; full or draining gateways are not candidates.
    public static Gateway Pick(int region)
    {
        Gateway best = null!; int bestCost = int.MaxValue;
        foreach (var g in Gateways)
        {
            if (g.Draining || g.Sessions.Count >= Cap) continue;
            int cost = g.Lat[region] + g.Sessions.Count * LoadPenaltyMs / Cap;
            if (cost < bestCost) { best = g; bestCost = cost; }
        }
        return best;
    }

    public static Session Connect(int sid, int region)
    {
        var g = Pick(region);
        var s = new Session { Sid = sid, Key = Fnv((uint)sid, KeySalt), Region = region, Addr = AddrBase + sid, Gw = g.Id };
        g.Sessions[sid] = s;
        return s;
    }

    // A packet carries session id, sequence number and a tag. The source address is NOT part of the identity, so a client can roam.
    public static Packet MakePacket(Session s, int seq, int addr) => new(s.Sid, seq, addr, Fnv(s.Key, (uint)s.Sid, (uint)seq));

    public static string Receive(Gateway g, Packet p, int now)
    {
        if (!g.Sessions.TryGetValue(p.Sid, out var s)) return "unknown session";
        if (p.Tag != Fnv(s.Key, (uint)p.Sid, (uint)p.Seq)) return "bad tag";
        if (p.Seq <= s.LastSeq) return "replay";
        bool roamed = p.Addr != s.Addr;
        s.Addr = p.Addr; s.LastSeq = p.Seq; s.LastSeen = now;
        return roamed ? "ok, roamed" : "ok";
    }

    // Dead-peer detection: a keepalive every 10 ticks, and a peer is dead after 3 missed keepalives.
    public static bool IsDead(Session s, int now) => now - s.LastSeen >= DeadAfter;

    // Drain: stop accepting, then resume every session elsewhere with the same key and sequence number.
    public static int Drain(Gateway g)
    {
        g.Draining = true;
        int moved = 0;
        foreach (var s in g.Sessions.Values.ToList())
        {
            var to = Pick(s.Region);
            g.Sessions.Remove(s.Sid); s.Gw = to.Id; to.Sessions[s.Sid] = s; moved++;
        }
        return moved;
    }

    public static uint Ip(uint a, uint b, uint c, uint d) => (a << 24) | (b << 16) | (c << 8) | d;
    public static bool InNet(uint addr, uint net, int bits) => (addr >> (Ipv4Bits - bits)) == (net >> (Ipv4Bits - bits));
    public static bool ViaTunnel(uint addr) => InNet(addr, Ip(10, 0, 0, 0), 8) || InNet(addr, Ip(192, 168, 0, 0), 16);
}

public static class Program
{
    static string Loads() => string.Join(",", Fleet.Gateways.Select(g => g.Sessions.Count));
    static string B(bool b) => b ? "true" : "false";

    public static void Main()
    {
        var regions = Enumerable.Range(0, Fleet.Clients).Select(_ => Fleet.Rnd(Fleet.Regions)).ToList();
        var nearest = new int[Fleet.Lat.Length];
        foreach (var r in regions) { var col = Fleet.Lat.Select(l => l[r]).ToList(); nearest[col.IndexOf(col.Min())]++; }
        var sessions = regions.Select((r, i) => Fleet.Connect(i + 1, r)).ToList();
        int Avg() => sessions.Sum(s => Fleet.Gateways[s.Gw].Lat[s.Region]) / sessions.Count;
        Console.WriteLine($"nearest only: {string.Join(",", nearest)} | latency and load: {Loads()} | avg ms: {Avg()}");
        if (Fleet.Gateways.Any(g => g.Sessions.Count > Fleet.Cap)) throw new Exception("over capacity");

        var s1 = sessions[0]; var g1 = Fleet.Gateways[s1.Gw];
        Console.WriteLine($"seq 1 from home: {Fleet.Receive(g1, Fleet.MakePacket(s1, 1, s1.Addr), 5)}");
        Console.WriteLine($"seq 2 from new network: {Fleet.Receive(g1, Fleet.MakePacket(s1, 2, 7000), 10)}");
        Console.WriteLine($"seq 2 again: {Fleet.Receive(g1, Fleet.MakePacket(s1, 2, 8000), 11)}");
        Console.WriteLine($"forged tag: {Fleet.Receive(g1, Fleet.MakePacket(s1, 3, 9000) with { Tag = 1 }, 12)}");
        Console.WriteLine($"silent since tick 10, dead at 39: {B(Fleet.IsDead(s1, 39))} | at 40: {B(Fleet.IsDead(s1, 40))}");

        var busiest = Fleet.Gateways[0];
        foreach (var g in Fleet.Gateways) if (g.Sessions.Count > busiest.Sessions.Count) busiest = g;
        int before = busiest.Sessions.Count;
        Console.WriteLine($"drain gateway {busiest.Id} moved {Fleet.Drain(busiest)} of {before} | loads: {Loads()}");
        if (busiest.Sessions.Count != 0 || Fleet.Gateways.Sum(g => g.Sessions.Count) != 24) throw new Exception("drain lost sessions");
        Console.WriteLine($"session kept its sequence: {Fleet.Receive(Fleet.Gateways[s1.Gw], Fleet.MakePacket(s1, 3, 7100), 20)}");
        var addrs = new[] { Fleet.Ip(10, 4, 1, 9), Fleet.Ip(192, 168, 7, 1), Fleet.Ip(142, 250, 1, 1) };
        Console.WriteLine($"split tunnel: {string.Join(",", addrs.Select(a => Fleet.ViaTunnel(a) ? "tunnel" : "direct"))}");
    }
}
