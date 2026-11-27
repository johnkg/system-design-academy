// Structured output in C#: validate and retry, a token mask, and an allow-list for tool calls.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

public static class Program
{
    private static (bool Ok, string Message) Validate(string text)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(text); }
        catch (JsonException) { return (false, "invalid JSON"); }
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("order_id", out var id)
            || id.ValueKind != JsonValueKind.Number || !id.TryGetInt32(out var orderId))
            return (false, "wrong shape (order_id must be an integer)");
        if (!root.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String)
            return (false, "wrong shape (status must be a string)");
        return (true, $"valid -> order_id={orderId}, status={status.GetString()}");
    }

    public static void Main()
    {
        // 1. Validate and retry, with a scripted model that gets it wrong twice.
        var replies = new[]
        {
            "Sure! Here is the JSON: {\"order_id\": 42}",
            "{\"order_id\": \"42\", \"status\": \"shipped\"}",
            "{\"order_id\": 42, \"status\": \"shipped\"}",
        };
        for (var attempt = 1; attempt <= replies.Length; attempt++)
        {
            var (ok, message) = Validate(replies[attempt - 1]);
            Console.WriteLine($"attempt {attempt}: {message}");
            if (ok) break;
        }

        // 2. A token mask: only the tokens the grammar allows can be chosen.
        string[] tokens = { "4", "7", "x", "\"", "}" };
        double[] logits = { 1.0, 2.0, 3.0, 2.5, 0.5 };
        var allowed = new HashSet<string> { "4", "7" }; // after '{"order_id": ' only a digit is valid
        string Best(double[] scores) => tokens[Array.IndexOf(scores, scores.Max())];
        Console.WriteLine($"unconstrained pick: {Best(logits)}");
        var masked = logits.Select((score, i) => allowed.Contains(tokens[i]) ? score : double.NegativeInfinity).ToArray();
        Console.WriteLine("allowed here: " + string.Join(", ", tokens.Where(allowed.Contains)));
        Console.WriteLine($"constrained pick: {Best(masked)}");

        // 3. Function calling: the model asks, the application checks and acts.
        var orders = new Dictionary<int, string> { [42] = "shipped" };
        var tools = new Dictionary<string, Func<JsonElement, string>>
        {
            ["get_order"] = args => orders[args.GetProperty("order_id").GetInt32()],
        };
        foreach (var text in new[] { "{\"name\": \"get_order\", \"arguments\": {\"order_id\": 42}}", "{\"name\": \"delete_all\", \"arguments\": {}}" })
        {
            var call = JsonDocument.Parse(text).RootElement;
            var name = call.GetProperty("name").GetString()!;
            if (!tools.ContainsKey(name))
            {
                Console.WriteLine($"refused: {name} is not an allowed tool");
                continue;
            }
            var args = call.GetProperty("arguments");
            Console.WriteLine($"call {name}(order_id={args.GetProperty("order_id").GetInt32()}) -> {tools[name](args)}");
        }
    }
}
