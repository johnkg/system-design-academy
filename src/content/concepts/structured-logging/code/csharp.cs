// A structured logger in C#: JSON events, a correlation id on every line, and redaction of secrets.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var gateway = new Logger("gateway").Child(new() { ["request_id"] = "req-8f3a" });
        gateway.Log("info", "request_received", new() { ["user_id"] = 42, ["path"] = "/pay" });

        var payments = new Logger("payments").Child(new() { ["request_id"] = "req-8f3a" }); // the id arrived in a header
        payments.Log("error", "payment_failed", new() { ["user_id"] = 42, ["reason"] = "card_declined", ["card_number"] = "4111111111111111" });

        // A different request, with its own id
        new Logger("gateway").Child(new() { ["request_id"] = "req-77c1" }).Log("info", "request_received", new() { ["user_id"] = 7, ["path"] = "/pay" });
    }
}

public class Logger
{
    static readonly HashSet<string> Sensitive = new() { "password", "card_number", "token" };
    static int _tick; // one shared clock, so timestamps increase across all loggers

    private readonly string _service;
    private readonly Dictionary<string, object> _baseFields;

    public Logger(string service, Dictionary<string, object>? baseFields = null)
    {
        _service = service;
        _baseFields = baseFields ?? new();
    }

    // A child logger carries extra fields, such as the request id, on every line it writes
    public Logger Child(Dictionary<string, object> fields)
    {
        var merged = new Dictionary<string, object>(_baseFields);
        foreach (var (key, value) in fields) merged[key] = value;
        return new Logger(_service, merged);
    }

    public void Log(string level, string evt, Dictionary<string, object>? fields = null)
    {
        var record = new Dictionary<string, object>
        {
            ["ts"] = $"T+{++_tick:00}", ["level"] = level, ["service"] = _service, ["event"] = evt,
        };
        foreach (var (key, value) in _baseFields) record[key] = value;
        foreach (var (key, value) in fields ?? new()) record[key] = Sensitive.Contains(key) ? "[redacted]" : value;
        Console.WriteLine("{" + string.Join(",", record.Select(kv => $"\"{kv.Key}\":{(kv.Value is string s ? $"\"{s}\"" : kv.Value)}")) + "}");
    }
}
