// The retrieval core of a RAG platform, in C#:
// documents are split into chunks, indexed by keyword and by a toy embedding, searched with the asker's groups,
// merged with reciprocal rank fusion, and re-synced so that changes and deletes reach the index.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

public record Doc(string Id, string Title, string[] Acl, string Text);
public class Chunk { public string Id = "", Title = ""; public string[] Acl = Array.Empty<string>(); public string[] Words = Array.Empty<string>(); public int[] Vec = Array.Empty<int>(); }

public class Index
{
    const int Dim = 16;
    const int RrfK = 60, RrfScale = 1000000; // the usual fusion constant; scores kept as whole numbers
    public static int EmbedCalls = 0; // a real embedding call costs money, so we count them
    public readonly Dictionary<string, Chunk> Chunks = new();   // chunk id -> chunk
    readonly Dictionary<string, (uint Hash, List<string> Ids)> docs = new(); // doc id -> hash and chunk ids

    public static uint Hash(string s) { uint h = 2166136261; foreach (char c in s) { h ^= c; h *= 16777619; } return h; }
    public static string[] Tokens(string text) => Regex.Split(text.ToLowerInvariant(), "[^a-z]+").Where(w => w.Length > 2).ToArray();

    static int[] Embed(string[] words) // toy embedding: each word adds +1 or -1 to one of 16 dimensions
    {
        EmbedCalls++;
        var v = new int[Dim];
        foreach (var w in words) { uint h = Hash(w); v[h % Dim] += ((h >> 8) & 1) == 1 ? 1 : -1; }
        return v;
    }
    static int Dot(int[] a, int[] b) => a.Select((x, i) => x * b[i]).Sum();

    // Bring one document up to date. Unchanged text costs nothing; a changed ACL only rewrites metadata.
    public void Sync(Doc doc)
    {
        uint textHash = Hash(doc.Text);
        if (docs.TryGetValue(doc.Id, out var old))
        {
            if (old.Hash == textHash) { foreach (var id in old.Ids) Chunks[id].Acl = doc.Acl; return; }
            Remove(doc.Id); // replace old chunks, never leave them behind
        }
        var ids = new List<string>();
        var parts = doc.Text.Split(". ");
        for (int i = 0; i < parts.Length; i++)
        {
            string id = $"{doc.Id}#{i}"; var words = Tokens(parts[i]);
            Chunks[id] = new Chunk { Id = id, Title = doc.Title, Acl = doc.Acl, Words = words, Vec = Embed(words) };
            ids.Add(id);
        }
        docs[doc.Id] = (textHash, ids);
    }
    void Remove(string docId) { foreach (var id in docs[docId].Ids) Chunks.Remove(id); docs.Remove(docId); }
    // Delete propagation: anything the source no longer lists is removed from the index.
    public void SyncAll(List<Doc> source)
    {
        foreach (var d in source) Sync(d);
        var live = source.Select(d => d.Id).ToHashSet();
        foreach (var id in docs.Keys.ToList()) if (!live.Contains(id)) Remove(id);
    }

    // The asker's groups are applied before ranking, so the top k is full of chunks they may read.
    public List<string> Search(string[] groups, string query, int k, bool enforce = true)
    {
        var q = Tokens(query); var qv = Embed(q);
        var allowed = Chunks.Values.Where(c => !enforce || c.Acl.Any(g => groups.Contains(g))).ToList();
        var keyword = allowed.Select(c => (c, s: q.Sum(w => c.Words.Count(x => x == w))));
        var vector = allowed.Select(c => (c, s: Dot(qv, c.Vec)));
        List<string> ByScore(IEnumerable<(Chunk c, int s)> list) =>
            list.Where(e => e.s > 0).OrderByDescending(e => e.s).ThenBy(e => e.c.Id, StringComparer.Ordinal).Select(e => e.c.Id).ToList();

        var fused = new Dictionary<string, int>(); // reciprocal rank fusion: a chunk near the top of either list scores well
        foreach (var ranked in new[] { ByScore(keyword), ByScore(vector) })
            for (int r = 0; r < ranked.Count; r++) fused[ranked[r]] = fused.GetValueOrDefault(ranked[r]) + RrfScale / (RrfK + r + 1);
        return fused.OrderByDescending(e => e.Value).ThenBy(e => e.Key, StringComparer.Ordinal).Take(k).Select(e => e.Key).ToList();
    }
}

public static class Program
{
    public static int Main()
    {
        var source = new List<Doc> {
            new("hr1", "Leave policy", new[] { "all" }, "Employees get sixteen weeks of paid parental leave. Request leave in the people portal. Managers approve leave within two days"),
            new("hr2", "Salary bands", new[] { "hr" }, "Salary bands are reviewed each year. Senior engineer salary starts at band five. Bonus targets follow the salary band"),
            new("en1", "Failover runbook", new[] { "eng" }, "When the primary database fails, page the on call engineer. Check replication lag before moving traffic. Approve the failover in the portal"),
            new("tr1", "Travel policy", new[] { "all" }, "Book travel in the portal. Flights above five hundred dollars need manager approval"),
        };
        var index = new Index();
        index.SyncAll(source);
        string Show(IEnumerable<string> ids) => string.Join(", ", ids.Select(id => $"{id} ({index.Chunks[id].Title})"));

        string query = "salary band approval in the portal";
        const int TopK = 3, WideK = 5;
        var eng = new[] { "all", "eng" };
        var asEngineer = index.Search(eng, query, TopK);
        var asHr = index.Search(new[] { "all", "hr" }, query, TopK);
        Console.WriteLine($"engineer asks: {Show(asEngineer)}");
        Console.WriteLine($"hr asks: {Show(asHr)}");

        var unfiltered = index.Search(eng, query, TopK, false).Where(id => !index.Chunks[id].Acl.Any(g => eng.Contains(g))).ToList();
        Console.WriteLine($"without the filter, the engineer's top 3 would hold {unfiltered.Count} unreadable chunk(s): {Show(unfiltered)}");

        int callsBefore = Index.EmbedCalls;
        index.SyncAll(source);
        Console.WriteLine($"re-sync with no changes: {Index.EmbedCalls - callsBefore} embedding calls");
        source[2] = source[2] with { Text = "When the primary database fails, page the on call engineer. Promote the replica with the lowest lag" };
        source[1] = source[1] with { Acl = new[] { "hr", "eng" } };
        source.RemoveAt(source.Count - 1); // the travel policy is deleted at the source
        index.SyncAll(source);
        int syncCalls = Index.EmbedCalls - callsBefore;
        Console.WriteLine($"after edit, ACL change and delete: {syncCalls} embedding calls, {index.Chunks.Count} chunks");
        Console.WriteLine($"engineer asks again: {Show(index.Search(eng, query, TopK))}");

        bool leaked = index.Chunks.Keys.Any(id => id.StartsWith("tr1"));
        bool hrSeen = index.Search(eng, "salary band", WideK).Any(id => id.StartsWith("hr2"));
        bool secret = asEngineer.Any(id => id.StartsWith("hr2"));
        Console.WriteLine($"deleted doc still indexed: {leaked.ToString().ToLowerInvariant()}; hr doc hidden before the ACL change: {(!secret).ToString().ToLowerInvariant()}; visible after: {hrSeen.ToString().ToLowerInvariant()}");
        return leaked || secret || !hrSeen || syncCalls != 2 || unfiltered.Count == 0 ? 1 : 0;
    }
}
