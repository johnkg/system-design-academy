// Reliable delivery over a lossy network, tick by tick, in C#:
// numbered segments, cumulative acknowledgements, in-order delivery and retransmission.
// This is a teaching model of what TCP does, not real networking code.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Total = 5;      // segments 0 to 4
    const int Latency = 1;    // ticks for a packet to cross the network
    const int Timeout = 4;    // ticks before the sender resends an unacknowledged segment
    const int LastTick = 11;  // the simulation runs ticks 0 to 11
    static readonly HashSet<int> LostFirstTime = new() { 2 }; // the network drops segment 2 the first time it is sent

    record Packet(int ArriveAt, string Kind, int N);

    static readonly List<Packet> InFlight = new(); // packets travelling
    static readonly int?[] SentAt = new int?[Total];
    static readonly int[] Attempts = new int[Total];
    static readonly HashSet<int> Received = new();
    static int nextToDeliver; // receiver: the next segment the application is waiting for
    static int acked;         // sender: everything below this has been acknowledged

    static void Transmit(int tick, int segment)
    {
        SentAt[segment] = tick;
        Attempts[segment]++;
        var label = Attempts[segment] > 1 ? "resends" : "sends";
        if (Attempts[segment] == 1 && LostFirstTime.Contains(segment))
        {
            Console.WriteLine($"tick {tick}: sender {label} segment {segment} -> LOST in the network");
        }
        else
        {
            Console.WriteLine($"tick {tick}: sender {label} segment {segment}");
            InFlight.Add(new Packet(tick + Latency, "data", segment));
        }
    }

    public static void Main()
    {
        for (var tick = 0; tick <= LastTick; tick++)
        {
            // Packets that arrive on this tick
            foreach (var packet in InFlight.Where(p => p.ArriveAt == tick).ToList())
            {
                if (packet.Kind == "data")
                {
                    Received.Add(packet.N);
                    var delivered = new List<int>();
                    while (Received.Contains(nextToDeliver)) delivered.Add(nextToDeliver++);
                    Console.WriteLine($"tick {tick}: receiver gets {packet.N}, delivers [{string.Join(",", delivered)}] to the application");
                    InFlight.Add(new Packet(tick + Latency, "ack", nextToDeliver)); // "I have everything below n"
                }
                else
                {
                    acked = Math.Max(acked, packet.N);
                }
            }

            // The sender sends one new segment per tick, and resends the oldest unacknowledged one after a timeout
            if (tick < Total) Transmit(tick, tick);
            else if (acked < Total && SentAt[acked] is int sent && tick - sent >= Timeout) Transmit(tick, acked);
        }

        Console.WriteLine($"delivered in order: {nextToDeliver} of {Total} segments");
        Console.WriteLine("UDP would have delivered [0,1,3,4] immediately and never delivered 2");
    }
}
