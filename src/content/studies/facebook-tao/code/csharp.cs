// A miniature of the TAO data model and request path from Facebook's "TAO: The power of the graph" (2013), in C#
// (a teaching model, not Facebook's code): typed objects and typed, timed associations, automatic inverse edges, point, range and
// count queries, and a follower cache in front of a leader cache in front of the database (MySQL's role), where a write travels
// through the leader and every cache on the way updates from the reply. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

const int Shards = 4;
var inverse = new Dictionary<string, string> { ["friend"] = "friend", ["like"] = "liked_by", ["liked_by"] = "like" };
int ShardOf(int id) => id % Shards; // every object and every association list of an id lives on one shard

var dbObjects = new Dictionary<int, Obj>(); // the persistent store
var dbLists = new Dictionary<string, List<Edge>>();
int dbReads = 0;
var leaderObjects = new Dictionary<int, Obj>(); // regional cache that talks to the database
var leaderLists = new Dictionary<string, List<Edge>>();
var followerObjects = new Dictionary<int, Obj>(); // cache that clients talk to
var followerLists = new Dictionary<string, List<Edge>>();
string served = ""; // which tier answered the last read
string ListKey(int id1, string type) => $"{id1}:{type}";

// follower, then leader, then database; fill the caches on the way back
T TierRead<T, K>(Dictionary<K, T> f, Dictionary<K, T> l, K key, Func<T> fromDb) where K : notnull
{
    if (f.TryGetValue(key, out var inFollower)) { served = "follower"; return inFollower; }
    if (l.TryGetValue(key, out var inLeader)) { served = "leader"; f[key] = inLeader; return inLeader; }
    dbReads++; served = "database";
    var value = fromDb();
    l[key] = value; f[key] = value;
    return value;
}

void ObjectCreate(int id, string type, string name)
{
    var obj = new Obj(id, type, name);
    dbObjects[id] = obj; leaderObjects[id] = obj; followerObjects[id] = obj;
}
Obj ObjectGet(int id) => TierRead(followerObjects, leaderObjects, id, () => dbObjects[id]);
List<Edge> AssocRange(int id1, string type, int limit = int.MaxValue) =>
    TierRead(followerLists, leaderLists, ListKey(id1, type), () => dbLists.TryGetValue(ListKey(id1, type), out var l) ? l : new List<Edge>()).Take(limit).ToList();

void WriteList(string key, Func<List<Edge>, List<Edge>> update) // the write goes follower -> leader -> database; each tier updates from the reply
{
    var next = update(dbLists.TryGetValue(key, out var old) ? old : new List<Edge>());
    dbLists[key] = next; leaderLists[key] = next; followerLists[key] = next;
}
void AssocAdd(int id1, string type, int id2, int time)
{
    void Add(int a, string t, int b) => WriteList(ListKey(a, t), list =>
        list.Where(e => e.Id2 != b).Prepend(new Edge(b, time)).OrderByDescending(e => e.Time).ToList());
    Add(id1, type, id2);
    Add(id2, inverse[type], id1); // the inverse edge is created automatically
}
void AssocDelete(int id1, string type, int id2)
{
    void Del(int a, string t, int b) => WriteList(ListKey(a, t), list => list.Where(e => e.Id2 != b).ToList());
    Del(id1, type, id2);
    Del(id2, inverse[type], id1);
}
int AssocCount(int id1, string type) => AssocRange(id1, type).Count; // TAO keeps a count so this is constant time; here it is the list length
bool AssocPoint(int id1, string type, int id2) => AssocRange(id1, type).Any(e => e.Id2 == id2);
string Names(List<Edge> list) => list.Count == 0 ? "none" : string.Join(", ", list.Select(e => $"{ObjectGet(e.Id2).Name}@{e.Time}"));

void Show(string label, int id1, string type)
{
    var list = AssocRange(id1, type, 10);
    string by = served; // Names() reads objects and would change `served`
    Console.WriteLine($"{label}: {Names(list)} (served by the {by})");
}

ObjectCreate(1, "user", "Alice");
ObjectCreate(2, "user", "Bob");
ObjectCreate(3, "user", "Carol");
ObjectCreate(4, "photo", "beach.jpg");
Console.WriteLine("shards: " + string.Join(", ", new[] { 1, 2, 3, 4 }.Select(i => $"{ObjectGet(i).Name} -> shard {ShardOf(i)}")));

AssocAdd(1, "friend", 2, 10);
AssocAdd(1, "friend", 3, 20);
AssocAdd(3, "like", 4, 30);
// Start with cold caches, as after a restart, to show where the reads come from.
leaderLists.Clear(); followerLists.Clear();

Show("Alice's friends, newest first", 1, "friend");
Show("Alice's friends again", 1, "friend");
followerLists.Clear(); // a different follower that has not seen this list yet
Show("Alice's friends, empty follower cache", 1, "friend");
Console.WriteLine($"Alice has {AssocCount(1, "friend")} friends");
Console.WriteLine($"is Bob a friend of Alice? {AssocPoint(1, "friend", 2).ToString().ToLower()}; is Alice a friend of Bob (the inverse edge)? {AssocPoint(2, "friend", 1).ToString().ToLower()}");
Show("who liked beach.jpg", 4, "liked_by");

ObjectCreate(5, "user", "Dave");
AssocAdd(1, "friend", 5, 40);
Show("after a write, Alice's friends", 1, "friend");
AssocDelete(1, "friend", 2);
Console.WriteLine($"after unfriending Bob: Alice has {AssocCount(1, "friend")} friends, Bob has {AssocCount(2, "friend")}");
Console.WriteLine($"database reads in total: {dbReads}");

record Obj(int Id, string Type, string Name);
record Edge(int Id2, int Time);
