// Pub/sub in C#: a topic with consumer groups. Each group gets every message; inside a group
// the message goes to just one member (the members share the work).
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var topic = new Topic();
        Action<string, string> handle = (message, who) => Console.WriteLine($"[{who}] handled {message}");

        topic.Subscribe("email", "worker-1", handle);
        topic.Subscribe("inventory", "worker-1", handle);
        topic.Subscribe("inventory", "worker-2", handle); // a second instance shares the inventory group's work
        topic.Subscribe("analytics", "worker-1", handle);

        foreach (var id in new[] { "order-1", "order-2" }) topic.Publish(id);

        topic.Subscribe("fraud-check", "worker-1", handle); // added later: the publisher is unchanged
        topic.Publish("order-3");
    }
}

public class Topic
{
    private record Member(string Name, Action<string, string> Handler);
    private class Group { public List<Member> Members { get; } = new(); public int Next; }

    private readonly Dictionary<string, Group> _groups = new(); // insertion order is kept for small dictionaries

    public void Subscribe(string group, string name, Action<string, string> handler)
    {
        if (!_groups.TryGetValue(group, out var g)) _groups[group] = g = new Group();
        g.Members.Add(new Member(name, handler));
    }

    public void Publish(string message) // the publisher neither knows nor waits for the subscribers
    {
        foreach (var (group, g) in _groups)
        {
            var member = g.Members[g.Next++ % g.Members.Count]; // round robin inside the group
            member.Handler(message, $"{group}/{member.Name}");
        }
    }
}
