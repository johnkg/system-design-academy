// A gateway session in C#: every message gets a per-user sequence number, a bounded queue protects the server
// from a slow client, and a short buffer lets a client that reconnects resume from the last number it saw.
using System;
using System.Collections.Generic;
using System.Linq;

public record Msg(int Seq, string Text);
public record Resumed(bool Refresh, int Seq, List<Msg> Messages);

public class Session
{
    const int Buffer = 5; // messages kept for resume
    public const int Queue = 4;  // messages waiting for one connection before it is cut off
    public int Seq; public bool Connected = true; public int CutOffs;
    public List<Msg> Buf = new(); public List<Msg> Out = new();

    public void Send(string text)
    {
        var msg = new Msg(++Seq, text);
        Buf.Add(msg);
        if (Buf.Count > Buffer) Buf.RemoveAt(0);          // the oldest message falls out of the resume window
        if (!Connected) return;                           // nobody to write to: the buffer is all we keep
        if (Out.Count >= Queue) { Connected = false; Out.Clear(); CutOffs++; return; } // slow consumer: close it
        Out.Add(msg);
    }

    // The client says "my last sequence number was n". Replay what follows, or ask for a full refresh.
    public Resumed Resume(int last)
    {
        Connected = true; Out.Clear();
        if (last >= Seq) return new Resumed(false, Seq, new());
        if (Buf[0].Seq > last + 1) return new Resumed(true, Seq, new()); // the gap is older than the buffer
        return new Resumed(false, Seq, Buf.Where(m => m.Seq > last).ToList());
    }
}

public class Client
{
    public int Last; public List<int> Applied = new();
    public void Apply(Msg m) { if (m.Seq <= Last) return; Last = m.Seq; Applied.Add(m.Seq); } // a repeat is ignored
    public void Read(Session s, int n) { for (int i = 0; i < n && s.Out.Count > 0; i++) { var m = s.Out[0]; s.Out.RemoveAt(0); Apply(m); } }
    public string Reconnect(Session s)
    {
        var r = s.Resume(Last);
        if (r.Refresh) { Last = r.Seq; return $"refresh to {r.Seq}"; }
        foreach (var m in r.Messages) Apply(m);
        return $"replay [{string.Join(",", r.Messages.Select(m => m.Seq))}]";
    }
}

public static class Program
{
    public static int Main()
    {
        var s = new Session(); var c = new Client();
        for (int i = 1; i <= 6; i++) { s.Send($"m{i}"); c.Read(s, 1); }
        Console.WriteLine($"connected: client has seen up to {c.Last}");

        s.Connected = false;                              // the phone enters a tunnel
        for (int i = 7; i <= 9; i++) s.Send($"m{i}");
        Console.WriteLine($"resume from {c.Last}: {c.Reconnect(s)}");

        s.Connected = false;                              // a long outage: more messages than the buffer holds
        for (int i = 10; i <= 17; i++) s.Send($"m{i}");
        Console.WriteLine($"resume from {c.Last}: {c.Reconnect(s)}");

        for (int i = 18; i <= 23; i++) { s.Send($"m{i}"); if (i == 18) c.Read(s, 1); } // the client reads one, then stops reading
        Console.WriteLine($"slow client cut off {s.CutOffs} time; queue limit {Session.Queue}");
        Console.WriteLine($"resume from {c.Last}: {c.Reconnect(s)}");
        c.Apply(new Msg(23, "m23"));                      // the same message arrives a second time
        bool ordered = c.Applied.Zip(c.Applied.Skip(1), (a, b) => b > a).All(x => x);
        Console.WriteLine($"applied {c.Applied.Count} messages, last {c.Last}, in order: {ordered.ToString().ToLower()}");
        return c.Last != s.Seq || s.CutOffs != 1 || c.Applied.Distinct().Count() != c.Applied.Count ? 1 : 0;
    }
}
