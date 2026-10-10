// Mediator in C#. Users talk only to the ChatRoom.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var room = new ChatRoom();
        var ada = new User("Ada");
        var bob = new User("Bob");
        var cy = new User("Cy");
        foreach (var u in new[] { ada, bob, cy }) room.Register(u);

        ada.Send("Hi all");         // Bob and Cy receive it
        bob.Send("Hi Ada", "Ada");  // only Ada receives it
    }
}

public interface IChatMediator // Mediator
{
    void Register(User user);
    void Send(User from, string message, string? to = null);
}

public class ChatRoom : IChatMediator // Concrete Mediator
{
    private readonly Dictionary<string, User> _users = new();

    public void Register(User user) { _users[user.Name] = user; user.Room = this; }

    public void Send(User from, string message, string? to = null)
    {
        var recipients = to is null
            ? _users.Values.Where(u => u != from)
            : _users.Values.Where(u => u.Name == to);
        foreach (var user in recipients) user.Receive(from.Name, message);
    }
}

public class User(string name) // Colleague
{
    public string Name { get; } = name;
    public IChatMediator? Room { get; set; }

    public void Send(string message, string? to = null) => Room!.Send(this, message, to); // goes via the mediator
    public void Receive(string from, string message) => Console.WriteLine($"{Name} got \"{message}\" from {from}");
}
