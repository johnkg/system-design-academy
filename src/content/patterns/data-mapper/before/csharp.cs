// Without the pattern: the User reads and writes rows, so it knows the column names.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var row = new Dictionary<string, string> { ["full_name"] = "Ada Lovelace", ["mail"] = "ada@example.com" };
        var user = new User(row);
        Console.WriteLine($"Loaded: {user.Name} <{user.Email}>");

        // The schema changes: mail becomes email_address. The User and every class like it must be edited.
        var renamed = new Dictionary<string, string> { ["full_name"] = "Ada Lovelace", ["email_address"] = "ada@example.com" };
        try { new User(renamed); }
        catch (KeyNotFoundException) { Console.WriteLine("Broken after the column rename: User still reads column mail"); }
    }
}

public class User
{
    public string Name { get; }
    public string Email { get; }

    public User(Dictionary<string, string> row)
    {
        Name = row["full_name"]; // column names baked into the domain class
        Email = row["mail"];
    }
}
