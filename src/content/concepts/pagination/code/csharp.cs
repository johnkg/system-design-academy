// Offset and cursor pagination in C#, with a new post arriving between two page loads.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        const int limit = 5;
        const int posts = 20; // posts in the demo feed

        var offsetStore = new PostStore(posts);
        Console.WriteLine("offset pagination");
        Console.WriteLine($"  page 1: {string.Join(",", offsetStore.ByOffset(0, limit))}");
        offsetStore.Add(); // post 21 is published while the client reads
        Console.WriteLine($"  page 2: {string.Join(",", offsetStore.ByOffset(limit, limit))}   <- 16 appears again");

        var cursorStore = new PostStore(posts);
        Console.WriteLine("cursor pagination");
        var (ids, next) = cursorStore.ByCursor(null, limit);
        Console.WriteLine($"  page 1: {string.Join(",", ids)}");
        cursorStore.Add(); // the same new post
        var second = cursorStore.ByCursor(next, limit);
        Console.WriteLine($"  page 2: {string.Join(",", second.Ids)}   <- continues exactly after 16");
    }
}

public class PostStore
{
    private readonly List<int> _posts = new(); // newest first

    public PostStore(int count) { for (var id = count; id >= 1; id--) _posts.Add(id); }

    public void Add() => _posts.Insert(0, _posts[0] + 1);

    // OFFSET n LIMIT m: skip rows, then take some
    public List<int> ByOffset(int offset, int limit) => _posts.Skip(offset).Take(limit).ToList();

    // WHERE id < cursor LIMIT m: continue after the last id the client saw
    public (List<int> Ids, int? Next) ByCursor(int? cursor, int limit)
    {
        var rows = _posts.Where(id => cursor is null || id < cursor).Take(limit).ToList();
        return (rows, rows.Count > 0 ? rows[^1] : null);
    }
}
