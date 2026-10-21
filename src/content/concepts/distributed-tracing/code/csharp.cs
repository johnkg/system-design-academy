// A minimal tracer in C#: spans, parent-child links and trace context propagation.
// A fake clock moved by hand makes the durations deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    // Simulated work per service, in milliseconds.
    const int PaymentMs = 1800, OrdersBeforeMs = 20, OrdersAfterMs = 30, GatewayEachSideMs = 10;
    static int clock; // milliseconds
    static readonly List<Span> Spans = new();

    static Span StartSpan(string name, (string TraceId, string Name)? parent = null)
    {
        var span = new Span(name, parent?.TraceId ?? "abc123", parent?.Name, clock);
        Spans.Add(span);
        return span;
    }
    static void EndSpan(Span span) => span.End = clock;
    static void Work(int ms) => clock += ms; // pretend to do work

    // The caller puts the trace context in a header, and the callee builds its span from it
    static string ToHeader(Span span) => $"{span.TraceId}-{span.Name}";
    static (string TraceId, string Name) FromHeader(string header)
    {
        var parts = header.Split('-');
        return (parts[0], parts[1]);
    }

    static void PaymentService(string header)
    {
        var span = StartSpan("payment", FromHeader(header));
        Work(PaymentMs); // the slow part
        EndSpan(span);
    }

    static void OrderService(string header)
    {
        var span = StartSpan("orders", FromHeader(header));
        Work(OrdersBeforeMs);
        PaymentService(ToHeader(span)); // pass the context on
        Work(OrdersAfterMs);
        EndSpan(span);
    }

    static void Gateway()
    {
        var span = StartSpan("gateway");
        Work(GatewayEachSideMs);
        OrderService(ToHeader(span));
        Work(GatewayEachSideMs);
        EndSpan(span);
    }

    // Self time is a span's duration minus the time spent in its children: where the work really happened
    static int SelfTime(Span span) => span.End - span.Start - Spans.Where(s => s.ParentName == span.Name).Sum(s => s.End - s.Start);

    static int Depth(Span span) => span.ParentName is null ? 0 : 1 + Depth(Spans.First(s => s.Name == span.ParentName));

    public static void Main()
    {
        Gateway();

        // Print the trace as an indented tree with offsets and durations
        foreach (var span in Spans)
            Console.WriteLine($"{new string(' ', 2 * Depth(span))}{span.Name}  start +{span.Start} ms, took {span.End - span.Start} ms  [trace {span.TraceId}]");
        var total = Spans[0].End - Spans[0].Start;
        var busiest = Spans.Aggregate((a, b) => SelfTime(b) > SelfTime(a) ? b : a);
        Console.WriteLine($"total {total} ms; most self time: \"{busiest.Name}\" ({SelfTime(busiest)} ms)");
    }
}

public class Span(string name, string traceId, string? parentName, int start)
{
    public string Name { get; } = name;
    public string TraceId { get; } = traceId;
    public string? ParentName { get; } = parentName;
    public int Start { get; } = start;
    public int End { get; set; }
}
