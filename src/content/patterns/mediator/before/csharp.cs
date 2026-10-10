// Without the pattern: every user holds references to every other user.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var ada = new User("Ada"); var bob = new User("Bob"); var cy = new User("Cy");
        ada.Friends.AddRange(new[] { bob, cy });   // 3 users, 6 links to wire by hand
        bob.Friends.AddRange(new[] { ada, cy });
        cy.Friends.AddRange(new[] { ada, bob });

        ada.Send("Hi all");
        // A 4th user means editing all three existing users. A "no swearing" rule means
        // copying the check into every User. Muting someone means changing everyone's list.
    }
}

public class User(string name)
{
    public string Name { get; } = name;
    public List<User> Friends { get; } = new();
    public void Send(string message) { foreach (var f in Friends) f.Receive(Name, message); }
    public void Receive(string from, string message) => Console.WriteLine($"{Name} got \"{message}\" from {from}");
}
