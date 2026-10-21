// A Snowflake-style ID generator in C#:
// 41 bits of time, 10 bits of machine number and 12 bits of sequence make a 64-bit number that is unique and roughly sorted by time.
using System;
using System.Collections.Generic;

public class IdGenerator
{
    public const long Epoch = 1735689600000L; // 1 January 2025, so the 41 time bits last about 69 years from there
    const int MachineBits = 10, SequenceBits = 12;
    const long MaxSequence = (1L << SequenceBits) - 1; // 4095
    const long MaxMachine = (1L << MachineBits) - 1;   // 1023

    readonly long machine;
    readonly Func<long> clock;
    readonly Action sleep;
    long last = -1, sequence;

    public IdGenerator(int machineId, Func<long> clock, Action sleep) { machine = machineId; this.clock = clock; this.sleep = sleep; }

    public long Next()
    {
        long now = clock();
        if (now < last) throw new InvalidOperationException($"clock moved back by {last - now} ms: refusing to issue IDs"); // issuing now could repeat an old ID
        if (now == last)
        {
            sequence = (sequence + 1) & MaxSequence;
            if (sequence == 0) // 4096 IDs in this millisecond: wait for the next one
            {
                do { sleep(); now = clock(); } while (now <= last);
            }
        }
        else sequence = 0;
        last = now;
        return ((now - Epoch) << (MachineBits + SequenceBits)) | (machine << SequenceBits) | sequence;
    }

    public static (long Ms, long Machine, long Sequence) Decode(long id) => (id >> (MachineBits + SequenceBits), (id >> SequenceBits) & MaxMachine, id & MaxSequence);
}

public static class Program
{
    public static int Main()
    {
        // A clock we control, so the run is the same every time.
        const int StartOffset = 1000, ClockBackMs = 5; // the demo clock starts 1 s after the epoch
        const int Burst = 4097;                        // one more ID than fits in a millisecond
        long time = IdGenerator.Epoch + StartOffset;
        Func<long> clock = () => time;
        Action sleep = () => { time += 1; };

        var a = new IdGenerator(1, clock, sleep);
        var b = new IdGenerator(2, clock, sleep);
        var ids = new[] { a.Next(), a.Next(), b.Next(), b.Next() };
        foreach (var id in ids)
        {
            var d = IdGenerator.Decode(id);
            Console.WriteLine($"id {id}  = time +{d.Ms} ms, machine {d.Machine}, sequence {d.Sequence}");
        }

        var seen = new HashSet<long>(ids);
        time += 1;
        for (int i = 0; i < Burst; i++) seen.Add(a.Next()); // more than 4096 in one millisecond
        long spill = IdGenerator.Decode(a.Next()).Ms - (StartOffset + 1); // how many milliseconds after the busy one the generator is now
        Console.WriteLine($"{seen.Count} distinct IDs from two machines; the 4,097th ID of one millisecond was issued {spill} ms later, after waiting");

        bool refused = false;
        time -= ClockBackMs; // the clock is set back by 5 ms
        try { a.Next(); } catch (InvalidOperationException e) { refused = true; Console.WriteLine($"clock set back: {e.Message}"); }

        bool increasing = ids[0] < ids[1] && ids[2] < ids[3];
        return !increasing || seen.Count != ids.Length + Burst || spill != 1 || !refused ? 1 : 0;
    }
}
