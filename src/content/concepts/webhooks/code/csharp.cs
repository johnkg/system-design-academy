// A webhook receiver in C#: verify the signature, reject old timestamps, ignore duplicate events.
// A fixed secret and clock make the demo deterministic.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public static class Program
{
    public static void Main()
    {
        var body = "{\"id\":\"evt_9\",\"type\":\"payment.succeeded\",\"order\":\"order-42\"}";
        const int SentAt = 1000; // the sender's clock when it signed, in seconds
        var request = new Request(SentAt, Receiver.Sign(SentAt, body), body);
        var receiver = new Receiver();

        Console.WriteLine($"genuine event:      {receiver.Receive(request, 1010)}");
        Console.WriteLine($"same event again:   {receiver.Receive(request, 1020)}");
        Console.WriteLine($"forged body:        {receiver.Receive(request with { Body = body.Replace("order-42", "order-99") }, 1030)}");
        Console.WriteLine($"replayed too late:  {receiver.Receive(request, 2000)}");
        Console.WriteLine($"orders marked paid: [{string.Join(",", receiver.PaidOrders)}]");
    }
}

public record Request(long Timestamp, string Signature, string Body);

public class Receiver
{
    const string Secret = "whsec_demo";
    const int ToleranceSeconds = 300;
    private readonly HashSet<string> _handled = new();
    public List<string> PaidOrders { get; } = new();

    // The sender signs "timestamp.body" with the shared secret
    public static string Sign(long timestamp, string body) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.UTF8.GetBytes($"{timestamp}.{body}"))).ToLowerInvariant();

    public string Receive(Request request, long now)
    {
        var expected = Encoding.UTF8.GetBytes(Sign(request.Timestamp, request.Body));
        var given = Encoding.UTF8.GetBytes(request.Signature);
        if (!CryptographicOperations.FixedTimeEquals(expected, given)) return "400 bad signature";
        if (now - request.Timestamp > ToleranceSeconds) return "400 timestamp too old (possible replay)";

        using var doc = JsonDocument.Parse(request.Body);
        var id = doc.RootElement.GetProperty("id").GetString()!;
        if (!_handled.Add(id)) return "200 duplicate ignored"; // acknowledge, but do nothing
        PaidOrders.Add(doc.RootElement.GetProperty("order").GetString()!); // in real life: enqueue and reply right away
        return "200 processed";
    }
}
