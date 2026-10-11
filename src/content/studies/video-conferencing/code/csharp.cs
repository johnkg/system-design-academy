// An SFU choosing simulcast layers, in C#:
// every sender uploads a few layers of its video once, and the server forwards to each viewer the best layer that fits that viewer's downlink.
// Compared with a mesh, where every sender uploads a full copy to every other participant.
using System;
using System.Collections.Generic;
using System.Linq;

public record Person(int Id, int Up, int Down);

public static class Program
{
    static readonly int[] Layers = { 150, 500, 1500 }; // kbit/s of the low, medium and high layer
    const int N = 6;
    static long seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

    // A sender uploads layers from the lowest upwards for as long as they fit in its uplink.
    static List<int> Published(Person p)
    {
        var sent = new List<int>();
        int used = 0;
        foreach (var l in Layers) if (used + l <= p.Up) { sent.Add(l); used += l; }
        return sent;
    }

    public static int Main()
    {
        var people = new List<Person>();
        for (int id = 0; id < N; id++)
        {
            int up = 1000 + Random(6) * 1000, down = 1000 + Random(9) * 1000; // kbit/s, drawn in this order
            people.Add(new Person(id, up, down));
        }
        var sent = people.Select(Published).ToList();

        // A viewer splits its downlink evenly over the other participants and takes the best layer that fits its share.
        List<int> Choose(Person viewer)
        {
            int share = viewer.Down / (N - 1);
            return people.Where(p => p.Id != viewer.Id).Select(p =>
            {
                int pick = sent[p.Id][0];
                foreach (var l in sent[p.Id]) if (l <= share) pick = l;
                return pick;
            }).ToList();
        }

        int egress = 0, ingress = 0;
        foreach (var p in people)
        {
            var got = Choose(p);
            int total = got.Sum();
            egress += total; ingress += sent[p.Id].Sum();
            Console.WriteLine($"client {p.Id}: up {p.Up} down {p.Down} | sends {string.Join("+", sent[p.Id])} = {sent[p.Id].Sum()} | gets {string.Join(",", got)} = {total}");
            if (sent[p.Id].Sum() > p.Up || total > p.Down) return 1; // nobody may be asked for more than its link can carry
        }

        int meshUp = (N - 1) * Layers[2];
        int meshOver = people.Count(p => p.Up < meshUp);
        Console.WriteLine($"server: in {ingress}, out {egress} kbit/s");
        Console.WriteLine($"mesh would need {meshUp} up from each client: {meshOver} of {N} clients cannot send it");
        return (meshOver == 0 || egress <= ingress) ? 1 : 0;
    }
}
