// Composite in C#. Files and folders share IFileSystemItem.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var project = new Folder("project")
            .Add(new FileItem("readme.md", 10))
            .Add(new Folder("src")
                .Add(new FileItem("app.cs", 40))
                .Add(new FileItem("util.cs", 15)));

        project.Print();
        Console.WriteLine(project.GetSize()); // 65: the client never checks file vs folder
    }
}

public interface IFileSystemItem // Component
{
    int GetSize();
    void Print(string indent = "");
}

public class FileItem(string name, int size) : IFileSystemItem // Leaf
{
    public int GetSize() => size;
    public void Print(string indent = "") => Console.WriteLine($"{indent}{name} ({size})");
}

public class Folder(string name) : IFileSystemItem // Composite
{
    private readonly List<IFileSystemItem> _children = new();

    public Folder Add(IFileSystemItem item) { _children.Add(item); return this; }
    public int GetSize() => _children.Sum(c => c.GetSize()); // recurses

    public void Print(string indent = "")
    {
        Console.WriteLine($"{indent}{name}/ ({GetSize()})");
        foreach (var child in _children) child.Print(indent + "  ");
    }
}
