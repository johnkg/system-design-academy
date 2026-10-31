// A Snowflake-style ID generator in C#, with a clock we control so every run prints the same lines.
// Layout (teaching size): time in milliseconds | 3 machine bits | 2 sequence bits.
// Real layouts use more bits, for example 41 for time, 10 for the machine and 12 for the sequence.
using System;
using System.Collections.Generic;
using System.Linq;

public class IdGenerator
{
    public const int MachineBits = 3, SequenceBits = 2;
    public const long MaxSequence = (1L << SequenceBits) - 1; // 3, so 4 ids fit in one millisecond

    readonly long machine;
    readonly Func<long> clock;
    readonly Action waitOneMs;
    long last = -1, sequence;

    public IdGenerator(int machine, Func<long> clock, Action waitOneMs) { this.machine = machine; this.clock = clock; this.waitOneMs = waitOneMs; }

    public long Next()
    {
        long now = clock();
        if (now < last) throw new InvalidOperationException($"clock moved back by {last - now} ms, refusing to issue ids");
        if (now == last)
        {
            sequence = (sequence + 1) & MaxSequence;
            if (sequence == 0) // the sequence is used up: wait for the next millisecond
            {
                do { waitOneMs(); now = clock(); } while (now <= last);
            }
        }
        else sequence = 0;
        last = now;
        return (now << (MachineBits + SequenceBits)) | (machine << SequenceBits) | sequence;
    }

    public static long TimeOf(long id) => id >> (MachineBits + SequenceBits);
    public static string Decode(long id) => $"time {TimeOf(id)}, machine {(id >> SequenceBits) & ((1L << MachineBits) - 1)}, sequence {id & MaxSequence}";
}

public static class Program
{
    public static int Main()
    {
        const long StartMs = 1000;                            // where the fake clock starts
        const int OverflowRequest = 6;                        // more ids than fit in one millisecond
        const int ClockBackMs = 3;                            // how far the clock is set back
        const int YesterdayFirst = 41823, YesterdayLast = 43201; // auto-increment order numbers seen a day apart

        long time = StartMs;
        Func<long> clock = () => time;
        Action waitOneMs = () => { time += 1; };

        // 1. Two databases that each count from 1 hand out the same numbers.
        var nodeA = new[] { 1, 2, 3 }; var nodeB = new[] { 1, 2, 3 };
        Console.WriteLine($"auto-increment on 2 nodes: {nodeA.Length + nodeB.Length} ids, {nodeA.Concat(nodeB).Distinct().Count()} distinct");

        // 2. Different machine numbers keep two nodes apart, even in the same millisecond.
        var a = new IdGenerator(1, clock, waitOneMs); var b = new IdGenerator(2, clock, waitOneMs);
        var ids = new[] { a.Next(), a.Next(), b.Next(), b.Next() };
        foreach (var id in ids) Console.WriteLine($"id {id} = {IdGenerator.Decode(id)}");
        Console.WriteLine($"machines 1 and 2: {ids.Length} ids, {ids.Distinct().Count()} distinct");

        // 3. Two processes started with the same machine number repeat each other.
        var c = new IdGenerator(3, clock, waitOneMs); var d = new IdGenerator(3, clock, waitOneMs);
        var clash = new[] { c.Next(), c.Next(), d.Next(), d.Next() };
        Console.WriteLine($"both machine 3: {clash.Length} ids, {clash.Distinct().Count()} distinct");

        // 4. More ids than the sequence holds: the generator waits for the next millisecond.
        time += 1;
        var busy = new IdGenerator(4, clock, waitOneMs);
        var burst = Enumerable.Range(0, OverflowRequest).Select(_ => busy.Next()).ToArray();
        int burstTimes = burst.Select(IdGenerator.TimeOf).Distinct().Count();
        Console.WriteLine($"{OverflowRequest} ids asked in one millisecond: last one is {IdGenerator.Decode(burst[^1])}, spread over {burstTimes} ms");

        // 5. A clock set back is refused, not trusted.
        time -= ClockBackMs;
        bool refused = false;
        try { busy.Next(); } catch (InvalidOperationException e) { refused = true; Console.WriteLine($"clock set back: {e.Message}"); }

        // 6. Ids made later are larger, so sorting by value sorts by time.
        bool sorted = burst.OrderBy(x => x).SequenceEqual(burst);
        Console.WriteLine($"sorted by value is sorted by time: {sorted.ToString().ToLower()}");

        // 7. A plain counter tells a competitor your volume.
        Console.WriteLine($"two auto-increment ids a day apart: {YesterdayLast - YesterdayFirst} orders that day");

        return ids.Distinct().Count() != 4 || clash.Distinct().Count() != 2 || burstTimes != 2 || !refused || !sorted ? 1 : 0;
    }
}
