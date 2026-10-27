// A tiny model of the technique behind a server-authoritative editor, in C#. It is a teaching sketch, not Figma's code.
// 1. A document is a map of (object, property) to value. The server decides the order of changes, and the last change
//    to a property in that order wins. Different properties never conflict.
// 2. A client shows its own edit at once. While that edit is unacknowledged it ignores incoming changes to that property.
// 3. A child's parent and its position among its siblings are one property, and the server refuses a parent that makes a cycle.
// There is no randomness or clock, so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public class Client
{
    public string Name;
    public Dictionary<string, string> View = new();
    public Dictionary<string, int> Pending = new();
    public Client(string name) { Name = name; }
}

public record Change(Client From, string Key, string Value);
public record Node(string Parent, double Pos);

public static class Program
{
    static readonly Dictionary<string, string> server = new(); // "object.property" -> value, in the order the server accepted changes
    static readonly Client a = new("A"), b = new("B");
    static readonly Client[] clients = { a, b };
    static readonly Dictionary<string, Node> tree = new() { ["frame"] = new("page", 0.25), ["box"] = new("page", 0.75) }; // the page's children

    static Change Edit(Client client, string key, string value)
    {
        client.View[key] = value; // the screen changes immediately
        client.Pending[key] = client.Pending.GetValueOrDefault(key) + 1;
        Console.WriteLine($"{client.Name} edits {key} = {value}");
        return new Change(client, key, value);
    }

    static void Receive(Client client, Change change)
    {
        if (change.From == client) client.Pending[change.Key]--; // an acknowledgement
        if (client.Pending.GetValueOrDefault(change.Key) > 0)
        {
            Console.WriteLine($"  {client.Name} skips {change.Key} = {change.Value}: it has its own unacknowledged edit there");
            return;
        }
        client.View[change.Key] = change.Value;
    }

    // The server takes the changes in the order they reached it and tells everyone.
    static void Serve(Change[] changes)
    {
        for (int i = 0; i < changes.Length; i++)
        {
            var change = changes[i];
            server[change.Key] = change.Value;
            Console.WriteLine($"server #{i + 1}: {change.From.Name} sets {change.Key} = {change.Value}");
            foreach (var client in clients) Receive(client, change);
        }
    }

    static string Children(string parent) => string.Join(", ", tree
        .Where(kv => kv.Value.Parent == parent)
        .OrderBy(kv => kv.Value.Pos).ThenBy(kv => kv.Key, StringComparer.Ordinal)
        .Select(kv => kv.Key));

    static double Between(double low, double high) => (low + high) / 2; // a new position between two neighbours

    static void SetParent(string id, string parent, double pos)
    {
        for (var up = parent; up != "page"; up = tree[up].Parent)
        {
            if (up == id) { Console.WriteLine($"server refuses {id} under {parent}: that would make a cycle"); return; }
        }
        tree[id] = new Node(parent, pos); // parent and position change together, as one property
        Console.WriteLine($"{id} under {parent} at {pos.ToString("0.000", CultureInfo.InvariantCulture)}");
    }

    public static void Main()
    {
        Console.WriteLine("-- properties");
        var red = Edit(a, "box.fill", "red");
        var green = Edit(a, "box.fill", "green");
        var blue = Edit(b, "box.fill", "blue");
        var move = Edit(a, "box.x", "10");
        var fade = Edit(b, "box.opacity", "0.5");
        Serve(new[] { red, blue, move, green, fade }); // B's blue reached the server between A's two fills
        foreach (var c in clients) Console.WriteLine($"{c.Name} sees fill={c.View["box.fill"]} x={c.View["box.x"]} opacity={c.View["box.opacity"]}");
        Console.WriteLine($"server has fill={server["box.fill"]} x={server["box.x"]} opacity={server["box.opacity"]}");

        Console.WriteLine("-- tree");
        SetParent("label", "page", Between(0.25, 0.75));
        Console.WriteLine($"page children: {Children("page")}");
        SetParent("box", "page", tree["frame"].Pos / 2);
        Console.WriteLine($"page children: {Children("page")}");
        SetParent("frame", "box", 0.5); // one client puts frame inside box
        SetParent("box", "frame", 0.5); // at the same time another puts box inside frame
        var inFrame = Children("frame");
        Console.WriteLine($"box children: {Children("box")}; frame children: {(inFrame.Length > 0 ? inFrame : "none")}");
    }
}
