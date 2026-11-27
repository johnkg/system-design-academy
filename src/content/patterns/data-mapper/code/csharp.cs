// Data Mapper in C#. The User knows nothing about the table; the mapper does.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var table = new Table();
        table.Put(1, new() { ["full_name"] = "Ada Lovelace", ["mail"] = "ada@example.com" });
        var mapper = new UserMapper(table, nameColumn: "full_name", emailColumn: "mail");

        var user = mapper.Find(1);
        Console.WriteLine($"Loaded: {user.Name} <{user.Email}>");

        user.Rename("Ada King");
        mapper.Save(user);
        Console.WriteLine($"Row: {Show(table.Get(1))}");

        table.RenameColumn("mail", "email_address"); // the schema changes...
        var afterRename = new UserMapper(table, nameColumn: "full_name", emailColumn: "email_address"); // ...and only this line follows
        var again = afterRename.Find(1);
        Console.WriteLine($"Loaded after the column rename: {again.Name} <{again.Email}>");
    }

    private static string Show(Dictionary<string, string> row) => string.Join("; ", row.Select(p => $"{p.Key}={p.Value}"));
}

public class User(int id, string name, string email) // Domain object
{
    public int Id { get; } = id;
    public string Name { get; private set; } = name;
    public string Email { get; } = email;
    public void Rename(string name) => Name = name;
}

public class Table // Storage: rows are plain column-to-value dictionaries
{
    private readonly Dictionary<int, Dictionary<string, string>> _rows = new();

    public void Put(int id, Dictionary<string, string> row) => _rows[id] = new(row);
    public Dictionary<string, string> Get(int id) => new(_rows[id]);

    public void RenameColumn(string from, string to)
    {
        foreach (var id in _rows.Keys.ToList())
            _rows[id] = _rows[id].ToDictionary(p => p.Key == from ? to : p.Key, p => p.Value);
    }
}

public class UserMapper(Table table, string nameColumn, string emailColumn) // Mapper: the only class that reads or writes the columns; their names are configured where it is built
{
    public User Find(int id)
    {
        var row = table.Get(id);
        return new User(id, row[nameColumn], row[emailColumn]);
    }

    public void Save(User user) =>
        table.Put(user.Id, new() { [nameColumn] = user.Name, [emailColumn] = user.Email });
}
