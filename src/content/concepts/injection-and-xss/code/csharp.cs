// Keeping data and code apart in C#: parameterized queries and HTML encoding.
// The "database" is only a printout here, so the focus stays on how the query is built.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    // Unsafe: user input becomes part of the query text
    static string UnsafeQuery(string name) => $"SELECT * FROM users WHERE name = '{name}'";

    // Safe: the query text is fixed, and the value travels separately as data
    static (string Text, string[] Params) SafeQuery(string name) => ("SELECT * FROM users WHERE name = ?", new[] { name });

    // Column names cannot be parameters, so allow only known values
    static readonly HashSet<string> Sortable = new() { "name", "created" };
    static string OrderBy(string column) => Sortable.Contains(column) ? $"ORDER BY {column}" : "ORDER BY name";

    // Output encoding for HTML text and attribute values
    static string EscapeHtml(string text) =>
        text.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&#39;");

    public static void Main()
    {
        var attack = "' OR '1'='1";
        Console.WriteLine($"unsafe, normal input: {UnsafeQuery("alice")}");
        Console.WriteLine($"unsafe, attack input: {UnsafeQuery(attack)}");
        var safe = SafeQuery(attack);
        Console.WriteLine($"safe, attack input:   {safe.Text}  with params [{string.Join(",", safe.Params.Select(p => $"\"{p}\""))}]");

        Console.WriteLine($"sort by created: {OrderBy("created")}");
        Console.WriteLine($"sort by \"name; DROP TABLE users\": {OrderBy("name; DROP TABLE users")}");

        var review = "<script>steal(document.cookie)</script>";
        Console.WriteLine($"raw HTML:     <p>{review}</p>");
        Console.WriteLine($"encoded HTML: <p>{EscapeHtml(review)}</p>");
    }
}
