// Without the pattern: the client checks types and recurses by hand.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        object project = new FolderData("project", new List<object>
        {
            new FileData("readme.md", 10),
            new FolderData("src", new List<object> { new FileData("app.cs", 40), new FileData("util.cs", 15) }),
        });
        Console.WriteLine(TotalSize(project));
    }

    static int TotalSize(object item) => item switch // type check at every call site
    {
        FolderData f => f.Children.Sum(TotalSize),
        FileData file => file.Size,
        _ => throw new ArgumentException("Unknown item"),
    };
    // Every feature (print, search, delete...) repeats this switch.
    // A new kind of item, like a shortcut, must be added to every one of them.
}

public record FileData(string Name, int Size);
public record FolderData(string Name, List<object> Children);
