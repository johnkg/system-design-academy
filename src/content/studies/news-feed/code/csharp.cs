// A news feed that mixes pushed and pulled posts in C#:
// ordinary authors are pushed into followers' feed lists, popular authors are pulled and merged when the feed is read.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static string Show(FeedPage r) => string.Join(" | ", r.Page.Select(p => $"{p.Id}:{p.Author}:{p.Text}")) + $"  (next cursor: {(r.NextCursor is int c ? c.ToString() : "null")})";

    public static void Main()
    {
        const int PopularFollowers = 3; // an author with 3 or more followers counts as popular, to keep the demo small
        const int PageSize = 2;
        var svc = new FeedService(PopularFollowers);
        svc.Follow("ann", "bob");
        svc.Follow("dan", "bob");
        foreach (var user in new[] { "ann", "dan", "eve" }) svc.Follow(user, "cat"); // cat becomes popular

        Console.WriteLine($"bob posts 'lunch':        pushed to {svc.Publish("bob", "lunch")} feeds");
        Console.WriteLine($"cat posts 'big news':     pushed to {svc.Publish("cat", "big news")} feeds");
        Console.WriteLine($"bob posts 'coffee':       pushed to {svc.Publish("bob", "coffee")} feeds");

        var first = svc.Feed("ann", PageSize);
        Console.WriteLine($"ann page 1:               {Show(first)}");
        Console.WriteLine($"ann page 2:               {Show(svc.Feed("ann", PageSize, first.NextCursor))}");
        Console.WriteLine($"eve page 1:               {Show(svc.Feed("eve", PageSize))}");
    }
}

public record Post(int Id, string Author, string Text);

public record FeedPage(List<Post> Page, int? NextCursor);

public class FeedService
{
    private readonly Dictionary<string, HashSet<string>> _followers = new(); // author -> users
    private readonly Dictionary<string, HashSet<string>> _following = new(); // user -> authors
    private readonly Dictionary<string, List<int>> _feeds = new(); // user -> post ids, newest first (the precomputed feed list)
    private readonly Dictionary<string, List<Post>> _byAuthor = new(); // author -> posts, newest last
    private readonly Dictionary<int, Post> _posts = new(); // post id -> post
    private readonly int _popularThreshold;
    private int _clock;

    public FeedService(int popularThreshold) => _popularThreshold = popularThreshold;

    private static HashSet<string> Set(Dictionary<string, HashSet<string>> map, string key)
    {
        if (!map.TryGetValue(key, out var set)) map[key] = set = new HashSet<string>();
        return set;
    }

    public void Follow(string user, string author)
    {
        Set(_followers, author).Add(user);
        Set(_following, user).Add(author);
    }

    public bool IsPopular(string author) => Set(_followers, author).Count >= _popularThreshold;

    // Store the post once. Push it to followers' lists only when the author is not popular.
    public int Publish(string author, string text)
    {
        var post = new Post(++_clock, author, text);
        _posts[post.Id] = post;
        if (!_byAuthor.TryGetValue(author, out var own)) _byAuthor[author] = own = new List<Post>();
        own.Add(post);
        if (IsPopular(author)) return 0;
        var followers = Set(_followers, author);
        foreach (var user in followers)
        {
            if (!_feeds.TryGetValue(user, out var list)) _feeds[user] = list = new List<int>();
            list.Insert(0, post.Id);
        }
        return followers.Count;
    }

    // Merge the precomputed list with the latest posts of popular authors, remove duplicates,
    // and return one page. The cursor is the id of the last post shown, so new posts cannot shift the page.
    public FeedPage Feed(string user, int limit, int? cursor = null)
    {
        var ids = new HashSet<int>(_feeds.TryGetValue(user, out var list) ? list : new List<int>());
        foreach (var author in Set(_following, user))
        {
            if (IsPopular(author) && _byAuthor.TryGetValue(author, out var posts)) foreach (var p in posts) ids.Add(p.Id);
        }
        var page = ids
            .Where(id => cursor is null || id < cursor)
            .OrderByDescending(id => id)
            .Take(limit)
            .Select(id => _posts[id])
            .ToList();
        return new FeedPage(page, page.Count == limit ? page[^1].Id : null);
    }
}
