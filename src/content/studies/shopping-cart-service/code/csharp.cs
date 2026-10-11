// A shopping cart that merges without losing items, in C#:
// an add-wins observed-remove set for the items and a PN-counter for the quantities, compared with two simpler merge rules.
using System;
using System.Collections.Generic;
using System.Linq;

public class Replica
{
    public string Id;
    int n;                                                          // counter used to make unique add tags
    readonly Dictionary<string, string> tags = new();               // tag -> item, one tag per add operation
    readonly Dictionary<string, int> amount = new();                // tag -> quantity added by that operation
    readonly HashSet<string> dead = new();                          // tags that a remove has seen (tombstones)
    readonly Dictionary<string, int> dec = new();                   // "tag|replica" -> units taken away (a PN-counter's negative half)

    public Replica(string id, Replica? from = null)
    {
        Id = id;
        if (from == null) return;
        n = from.n;
        foreach (var kv in from.tags) tags[kv.Key] = kv.Value;
        foreach (var kv in from.amount) amount[kv.Key] = kv.Value;
        dead.UnionWith(from.dead);
        foreach (var kv in from.dec) dec[kv.Key] = kv.Value;
    }

    public void Add(string item, int q = 1) { var t = $"{Id}#{n++}"; tags[t] = item; amount[t] = q; }
    int Left(string t) => amount[t] - dec.Where(kv => kv.Key.Split('|')[0] == t).Sum(kv => kv.Value);
    List<string> Live(string item) => tags.Where(kv => kv.Value == item && !dead.Contains(kv.Key)).Select(kv => kv.Key).ToList();
    public int Qty(string item) => Live(item).Sum(Left);

    // More of an item is a new add (so a concurrent remove cannot cancel it); fewer takes units off a tag this replica can see.
    public void Adjust(string item, int d)
    {
        if (d > 0) { Add(item, d); return; }
        var k = $"{Live(item).First(t => Left(t) > 0)}|{Id}";
        dec[k] = dec.GetValueOrDefault(k) - d;
    }

    // A remove only covers the add tags this replica has seen.
    public void Remove(string item) => dead.UnionWith(Live(item));

    // Union of tags and tombstones, and the larger value for every counter: order and repeats do not matter.
    public Replica Merge(Replica o)
    {
        var r = new Replica("M", this);
        foreach (var kv in o.tags) r.tags[kv.Key] = kv.Value;
        foreach (var kv in o.amount) r.amount[kv.Key] = kv.Value;
        r.dead.UnionWith(o.dead);
        foreach (var kv in o.dec) r.dec[kv.Key] = Math.Max(r.dec.GetValueOrDefault(kv.Key), kv.Value);
        return r;
    }

    public SortedDictionary<string, int> View()
    {
        var items = tags.Values.Distinct().Where(i => Qty(i) > 0);
        return new SortedDictionary<string, int>(items.ToDictionary(i => i, Qty), StringComparer.Ordinal);
    }

    public int Size() => tags.Count + amount.Count + dead.Count + dec.Count;
}

public static class Program
{
    static string Show(IDictionary<string, int> c) => string.Join(" ", c.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"{kv.Key}:{kv.Value}"));
    static string List(IEnumerable<string> a) => a.Any() ? string.Join(",", a) : "-";

    static (string, bool) Compare(IDictionary<string, int> got, IDictionary<string, int> want)
    {
        var lost = want.Keys.Where(i => !got.ContainsKey(i)).ToList();
        var back = got.Keys.Where(i => !want.ContainsKey(i)).ToList();
        var wrong = got.Keys.Where(i => want.ContainsKey(i) && got[i] != want[i]).ToList();
        return ($"lost={List(lost)} back={List(back)} wrong={List(wrong)}", lost.Count + back.Count + wrong.Count == 0);
    }

    public static int Main()
    {
        // The shared cart, then a partition: a phone and a laptop each change their own copy.
        var phone = new Replica("A");
        phone.Add("book", 2); phone.Add("pen"); phone.Add("lamp");
        var laptop = new Replica("B", phone);
        phone.Remove("pen"); phone.Add("mug"); phone.Adjust("book", 2);       // phone: drop pen, add mug, book 2 -> 4
        laptop.Remove("lamp"); laptop.Add("pen"); laptop.Adjust("book", -1);  // laptop: drop lamp, one more pen (unseen by the phone's remove), book 2 -> 1
        var intended = new Dictionary<string, int> { ["book"] = 3, ["mug"] = 1, ["pen"] = 1 }; // the phone's remove only covered the pen it had seen, so the new pen stays

        var a = phone.View(); var b = laptop.View();
        IDictionary<string, int> lww = b;                                    // the laptop's clock was later, so its whole cart wins
        var union = new Dictionary<string, int>();
        foreach (var c in new[] { a, b }) foreach (var kv in c) union[kv.Key] = Math.Max(union.GetValueOrDefault(kv.Key), kv.Value);
        var merged = phone.Merge(laptop);

        Console.WriteLine($"intended: {Show(intended)}");
        var rows = new (string, IDictionary<string, int>)[] { ("last write wins", lww), ("union of items", union), ("add-wins set + counters", merged.View()) };
        foreach (var (name, cart) in rows) Console.WriteLine($"{name,-24} {Show(cart),-26} {Compare(cart, intended).Item1}");
        var flip = laptop.Merge(phone); var again = merged.Merge(laptop);
        bool orderFree = Show(flip.View()) == Show(merged.View()) && Show(again.View()) == Show(merged.View());
        Console.WriteLine($"merge order and repeats do not matter: {orderFree.ToString().ToLower()}; metadata entries: {merged.Size()}");
        return !Compare(merged.View(), intended).Item2 || Compare(lww, intended).Item2 || Compare(union, intended).Item2 || !orderFree ? 1 : 0;
    }
}
