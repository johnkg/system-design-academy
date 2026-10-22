// A deletion orchestrator in C#: a data map lists every store, each request fans out one task per store,
// failed tasks retry the next day, a legal hold pauses a request, and the lake is erased by destroying a per-user key.
using System;
using System.Collections.Generic;
using System.Linq;

string[] stores = { "users-db", "search-index", "cache", "lake", "warehouse", "processor-crm" };
var method = new Dictionary<string, string> { ["users-db"] = "delete rows", ["search-index"] = "delete docs", ["cache"] = "evict keys", ["lake"] = "shred key", ["warehouse"] = "delete rows", ["processor-crm"] = "api call" };
const int Grace = 2; // days between the soft delete and the hard delete
const int Deadline = 30; // days allowed by law
const int Users = 6, MaxRows = 3; // each user has 1..3 rows in every store
const int CrmFailMod = 3; // the CRM processor fails (user % 3) times before it succeeds
const int RestoreDay = 20; // the day a backup is restored

uint Fnv(string text) {
    uint h = 0x811C9DC5;
    foreach (char ch in text) h = unchecked((h ^ ch) * 16777619u);
    return h;
}
int[] XorStream(uint key, int[] bytes) { // a toy stream cipher, only to show the idea of crypto-shredding
    uint s = key;
    return bytes.Select(b => { s = unchecked(s * 1664525u + 1013904223u); return b ^ (int)(s >> 24); }).ToArray();
}

var keyring = new Dictionary<int, uint>(); // user -> key; destroying the entry is the erasure
var plain = stores.ToDictionary(s => s, s => new Dictionary<int, int>()); // rows per user, for the stores that hold plain text
var lake = new Dictionary<int, List<int[]>>();
for (int user = 1; user <= Users; user++) {
    keyring[user] = Fnv("key|" + user);
    for (int i = 0; i < stores.Length; i++) {
        int count = 1 + (user + i) % MaxRows;
        if (stores[i] != "lake") { plain[stores[i]][user] = count; continue; }
        lake[user] = Enumerable.Range(0, count).Select(n => XorStream(keyring[user], ($"lake:{user}:{n}").Select(c => (int)c).ToArray())).ToList();
    }
}
int Readable(string store, int user) {
    if (store != "lake") return plain[store].GetValueOrDefault(user, 0);
    if (!keyring.ContainsKey(user)) return 0;
    return lake[user].Count(r => new string(XorStream(keyring[user], r).Select(b => (char)b).ToArray()).StartsWith("lake:"));
}
int Total(int user) => stores.Sum(s => Readable(s, user));
void Erase(string store, int user) {
    if (store == "lake") keyring.Remove(user); // the ciphertext stays in the immutable files, unreadable
    else plain[store].Remove(user);
}

var holds = new Dictionary<int, int> { [4] = 10 }; // user 4 is under a legal hold until day 10
var backup = new Dictionary<int, int>(plain["users-db"]); // the day 0 snapshot is never edited
var reqs = new[] { (id: "r1", user: 2, filed: 0), (id: "r2", user: 4, filed: 0), (id: "r3", user: 5, filed: 1) };
var tasks = reqs.ToDictionary(r => r.id, r => stores.ToDictionary(s => s, s => 0));
var done = reqs.ToDictionary(r => r.id, r => -1);
var audit = new List<(string id, string store, string method, int day, string who)>();

foreach (var r in reqs)
    Console.WriteLine($"export {r.id} (user {r.user}) day {r.filed}: {string.Join(", ", stores.Select(s => $"{s} {Readable(s, r.user)}"))} = {Total(r.user)} records");
for (int day = 0; day <= Deadline; day++) {
    foreach (var r in reqs) {
        if (done[r.id] >= 0 || day < r.filed + Grace) continue;
        if (holds.ContainsKey(r.user) && day < holds[r.user]) continue; // blocked, and nothing is deleted
        foreach (var store in stores) {
            if (tasks[r.id][store] == -1) continue;
            tasks[r.id][store]++;
            if (store == "processor-crm" && tasks[r.id][store] <= r.user % CrmFailMod) { Console.WriteLine($"day {day}: {r.id} {store} failed, will retry"); continue; }
            Erase(store, r.user);
            tasks[r.id][store] = -1;
            audit.Add((r.id, store, method[store], day, Fnv("salt|" + r.user).ToString("x8")));
        }
        if (stores.All(s => tasks[r.id][s] == -1)) { done[r.id] = day; Console.WriteLine($"day {day}: {r.id} complete after {day - r.filed} days"); }
    }
}
Console.WriteLine($"audit entries: {audit.Count}, first: {audit[0].method} in {audit[0].store} for {audit[0].who}");
Console.WriteLine($"lake rows still in the files: {reqs.Sum(r => lake[r.user].Count)}, readable: {reqs.Sum(r => Readable("lake", r.user))}");

int Present(Dictionary<int, int> rows) => reqs.Count(r => rows.ContainsKey(r.user));
var replay = reqs.Where(r => done[r.id] >= 0 && done[r.id] <= RestoreDay).Select(r => r.user).ToList();
var restored = new Dictionary<int, int>(backup);
Console.WriteLine($"restore on day 20 without the replay list: {Present(restored)} deleted users are back");
foreach (var u in replay) restored.Remove(u);
Console.WriteLine($"restore on day 20 with the replay list [{string.Join(",", replay)}]: {Present(restored)} deleted users are back");

int late = reqs.Count(r => done[r.id] < 0 || done[r.id] > Deadline);
if (reqs.Any(r => Total(r.user) != 0) || late > 0 || Present(restored) != 0 || audit.Count != 18) Environment.Exit(1);
