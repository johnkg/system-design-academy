// A presence service in C#:
// each device session is a key that expires unless it is renewed by a heartbeat, a user is online while any session lives,
// and friends are told only when the user's status changes, not on every heartbeat.
using System;
using System.Collections.Generic;
using System.Linq;

public class Presence
{
    public const int Ttl = 30; // seconds a session survives without a heartbeat (three heartbeat intervals)
    readonly List<int>[] friendsOf;                 // user -> the users who must hear about this user
    readonly Dictionary<int, int> expiry = new();   // session key -> time at which it expires
    readonly Dictionary<int, int> live = new();     // user -> number of live sessions
    public readonly List<(int User, bool Online)> Events = new(); // status changes
    public int Fanout;                              // messages sent to friends

    public Presence(List<int>[] friendsOf) { this.friendsOf = friendsOf; }

    void Change(int user, bool online)
    {
        Events.Add((user, online));
        Fanout += friendsOf[user].Count;
    }

    public void Heartbeat(int user, int device, int now)
    {
        int key = user * 8 + device;
        bool isNew = !expiry.ContainsKey(key);
        expiry[key] = now + Ttl; // renewing is one cheap write
        if (!isNew) return;
        live[user] = live.GetValueOrDefault(user) + 1;
        if (live[user] == 1) Change(user, true); // the first session brings the user online
    }

    public void Disconnect(int user, int device) // a clean goodbye, or an expiry
    {
        if (!expiry.Remove(user * 8 + device)) return;
        live[user]--;
        if (live[user] == 0) Change(user, false); // the last session takes the user offline
    }

    public void Sweep(int now) // in a real store the TTL does this for us
    {
        foreach (var (key, at) in expiry.ToList()) if (at <= now) Disconnect(key / 8, key % 8);
    }

    public bool IsOnline(int user) => live.GetValueOrDefault(user) > 0;
}

public record Device(int U, int D, int Phase, int Dead, bool Graceful);

public static class Program
{
    static long seed = 77;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

    public static int Main()
    {
        const int users = 100;
        var friendsOf = new List<int>[users];
        var devices = new List<Device>();
        for (int u = 0; u < users; u++)
        {
            var list = new List<int>();
            while (list.Count < 6) { int f = Random(users); if (f != u && !list.Contains(f)) list.Add(f); }
            friendsOf[u] = list;
            int count = 1 + Random(3);
            for (int d = 0; d < count; d++)
            {
                int phase = Random(10); bool dies = Random(3) == 0;
                int dead = dies ? 30 + Random(220) : -1;
                devices.Add(new Device(u, d, phase, dead, Random(2) == 1));
            }
        }

        var presence = new Presence(friendsOf);
        int heartbeats = 0;
        for (int t = 0; t < 300; t++)
        {
            foreach (var x in devices)
            {
                if (x.Dead >= 0 && t == x.Dead && x.Graceful) presence.Disconnect(x.U, x.D); // others just go silent
                bool alive = x.Dead < 0 || t < x.Dead;
                if (alive && (t + x.Phase) % 10 == 0 && Random(5) != 0) // one heartbeat in five is lost
                {
                    presence.Heartbeat(x.U, x.D, t); heartbeats++;
                }
            }
            presence.Sweep(t);
        }

        int online = presence.Events.Count(e => e.Online);
        Console.WriteLine($"heartbeats: {heartbeats}, fan-out if each one were broadcast: {heartbeats * 6}");
        Console.WriteLine($"status changes: {presence.Events.Count} (online {online}, offline {presence.Events.Count - online}), fan-out: {presence.Fanout}");
        Console.WriteLine($"messages saved: {heartbeats * 6 / presence.Fanout}x");

        var stillThere = devices.Where(x => x.Dead < 0).Select(x => x.U).ToHashSet();
        bool right = true; int n = 0;
        for (int u = 0; u < users; u++) { if (presence.IsOnline(u)) n++; if (presence.IsOnline(u) != stillThere.Contains(u)) right = false; }
        var last = new Dictionary<int, bool>(); bool alternate = true;
        foreach (var (u, on) in presence.Events) { if (last.GetValueOrDefault(u) == on) alternate = false; last[u] = on; }
        Console.WriteLine($"online at the end: {n} of {users}; matches the devices still running: {right.ToString().ToLower()}");
        Console.WriteLine($"each user's changes alternate online and offline: {alternate.ToString().ToLower()}");
        return right && alternate ? 0 : 1;
    }
}
