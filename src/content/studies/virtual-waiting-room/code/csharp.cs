// A virtual waiting room, in C#:
// signed queue tokens carry a place in line, a pointer admits a fixed number per tick, and the pointer is all the state that must survive a crash.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

public record Saved(int Next, int Served, int Tick);

public class WaitingRoom
{
    static readonly byte[] Secret = Encoding.UTF8.GetBytes("room-secret");
    const int TagHex = 12, PassTicks = 5; // tag length in hex digits; how long an entry pass stays valid
    static string Mac(string text) => Convert.ToHexString(HMACSHA256.HashData(Secret, Encoding.UTF8.GetBytes(text))).ToLowerInvariant()[..TagHex];

    readonly int rate;                                     // people admitted per tick, set from what the backend can serve
    public int Next;                                       // next place in line to hand out
    public int Served;                                     // every place below this may enter
    public int Tick;
    readonly List<int> early = new();

    public WaitingRoom(int rate, Saved? saved = null)
    {
        this.rate = rate;
        if (saved != null) { Next = saved.Next; Served = saved.Served; Tick = saved.Tick; }
    }
    public Saved Save() => new(Next, Served, Tick);
    string TokenOf(int seq) => $"{seq}.{Mac("q" + seq)}";
    public void JoinEarly(int id) => early.Add(id);

    // Before the sale opens, arrival time means nothing, so the pool is shuffled once (a lottery) and then numbered.
    public List<(int Id, string Token)> Open(uint seed)
    {
        uint s = seed;
        // Fisher-Yates shuffle driven by a linear congruential generator (Numerical Recipes constants).
        for (int i = early.Count - 1; i > 0; i--)
        {
            s = unchecked(s * 1664525u + 1013904223u);
            int j = (int)((s >> 16) % (uint)(i + 1));
            (early[i], early[j]) = (early[j], early[i]);
        }
        return early.Select(id => (id, Join())).ToList();
    }
    public string Join() => TokenOf(Next++);

    int SeqOf(string token)
    {
        var parts = token.Split('.');
        return parts[0].All(char.IsAsciiDigit) && parts[1] == Mac("q" + parts[0]) ? int.Parse(parts[0]) : -1;
    }
    public string Status(string token)
    {
        int seq = SeqOf(token);
        if (seq < 0) return "invalid";
        if (seq < Served) return "admitted";
        int position = seq - Served + 1;
        return $"waiting, position {position}, about {(position + rate - 1) / rate} ticks";
    }
    public int Advance() { int before = Served; Tick++; Served = Math.Min(Next, Served + rate); return Served - before; }

    public string MakePass(int seq) { int exp = Tick + PassTicks; return $"{seq}.{exp}.{Mac($"p{seq}.{exp}")}"; }
    public bool PassOk(string pass)
    {
        var p = pass.Split('.');
        return p[2] == Mac($"p{p[0]}.{p[1]}") && int.Parse(p[0]) < Served && Tick <= int.Parse(p[1]);
    }
}

public static class Program
{
    static string Lower(bool flag) => flag ? "true" : "false";

    public static int Main()
    {
        const int Rate = 40, Early = 300, LotterySeed = 7, Ticks = 20, ArrivalsPerTick = 25;
        const int Client = 250, RestartAt = 5; // the client we follow, and the tick when the process restarts
        var room = new WaitingRoom(Rate);
        for (int id = 0; id < Early; id++) room.JoinEarly(id);
        var tokens = new Dictionary<int, string>();
        var lottery = room.Open(LotterySeed);
        foreach (var (id, token) in lottery) tokens[id] = token;
        Console.WriteLine($"opened with {room.Next} waiting; first five in the lottery: {string.Join(", ", lottery.Take(5).Select(e => e.Id))}");
        Console.WriteLine($"client 250: {room.Status(tokens[Client])}");

        int peak = 0; string pass = ""; bool crashChecked = false;
        for (int t = 1; t <= Ticks; t++)
        {
            for (int k = 0; k < ArrivalsPerTick; k++) tokens[Early + (t - 1) * ArrivalsPerTick + k] = room.Join();
            peak = Math.Max(peak, room.Advance());
            if (t == 1) pass = room.MakePass(0);
            if (t == RestartAt)
            {
                string before = room.Status(tokens[Client]);
                room = new WaitingRoom(Rate, room.Save());   // the whole process restarts, tokens in people's browsers stay valid
                crashChecked = before == room.Status(tokens[Client]);
                Console.WriteLine($"after a restart at tick 5, client 250: {room.Status(tokens[Client])}");
            }
        }
        var halves = tokens[Client].Split('.');
        string tag = halves[1];
        string forgedPosition = room.Status($"0.{tag}");
        string flippedTag = room.Status($"{halves[0]}.{tag[..^1]}{(tag.EndsWith('0') ? '1' : '0')}");
        Console.WriteLine($"peak admitted in one tick: {peak} (limit 40)");
        Console.WriteLine($"forged place 0 accepted: {Lower(forgedPosition != "invalid")}; altered tag accepted: {Lower(flippedTag != "invalid")}");
        Console.WriteLine($"old pass accepted at tick {room.Tick}: {Lower(room.PassOk(pass))}; fresh pass accepted: {Lower(room.PassOk(room.MakePass(100)))}");
        bool everyone = tokens.Values.All(tk => room.Status(tk) == "admitted");
        Console.WriteLine($"all {tokens.Count} admitted in order by tick {room.Tick}: {Lower(everyone)}");
        return (peak > Rate || !crashChecked || forgedPosition != "invalid" || flippedTag != "invalid" || !everyone || room.PassOk(pass)) ? 1 : 0;
    }
}
