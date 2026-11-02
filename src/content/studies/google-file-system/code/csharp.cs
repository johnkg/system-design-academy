// A miniature of the Google File System (SOSP 2003), in C# (a teaching model, not Google's code):
// one master keeps the namespace and the chunk map in memory, files are cut into fixed-size chunks, every chunk lives on
// three chunkservers, record append pads a chunk that cannot hold the record, a dead chunkserver's chunks are copied again,
// and a restarted master learns where chunks are by asking the chunkservers. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

const int ChunkSize = 10, Copies = 3; // bytes per chunk (GFS uses 64 MB) and replicas per chunk
var servers = new[] { "S1", "S2", "S3", "S4", "S5", "S6" };
var disks = servers.ToDictionary(s => s, s => new Dictionary<string, string>()); // chunk id -> bytes held
var alive = new HashSet<string>(servers);
var files = new Dictionary<string, List<string>>();
var where = new Dictionary<string, List<string>>();
int nextId = 1;
var opLog = new List<string>();

List<string> Pick(int count, IEnumerable<string>? exclude = null) // least-loaded live chunkservers, ties by name
{
    var skip = exclude?.ToHashSet() ?? new HashSet<string>();
    return servers.Where(s => alive.Contains(s) && !skip.Contains(s))
        .OrderBy(s => disks[s].Count).ThenBy(s => s, StringComparer.Ordinal).Take(count).ToList();
}

string NewChunk(string file)
{
    string id = $"c{nextId++}";
    files[file].Add(id);
    opLog.Add($"add {file} {id}"); // the namespace and file-to-chunk map are logged; locations are not
    var chosen = Pick(Copies);
    where[id] = chosen;
    foreach (var s in chosen) disks[s][id] = "";
    return id;
}

void RecordAppend(string file, string record) // the primary picks the offset; a record that does not fit pads the chunk and the client retries on the next one
{
    string id = files[file].Count > 0 ? files[file][^1] : NewChunk(file);
    int used = disks[where[id][0]][id].Length;
    if (used + record.Length > ChunkSize)
    {
        foreach (var s in where[id]) disks[s][id] += new string('.', ChunkSize - used);
        Console.WriteLine($"append {record}: does not fit in {id} ({ChunkSize - used} bytes left), chunk padded, retry on a new chunk");
        id = NewChunk(file);
    }
    foreach (var s in where[id]) disks[s][id] += record;
    Console.WriteLine($"append {record}: stored in {id} on {string.Join(",", where[id])}");
}

files["/logs/web"] = new List<string>();
foreach (var record in new[] { "AAAA", "BBBBBB", "CCCCCCC", "DDDDD" }) RecordAppend("/logs/web", record);
Console.WriteLine("chunks: " + string.Join(" ", files["/logs/web"].Select(id => $"{id}={disks[where[id][0]][id]}")));

alive.Remove("S2");
disks["S2"].Clear();
Console.WriteLine("S2 stops sending heartbeats and is treated as dead");
var need = where.Select(p => (Id: p.Key, Live: p.Value.Where(alive.Contains).ToList()))
    .Where(n => n.Live.Count < Copies).OrderBy(n => n.Live.Count).ToList();
Console.WriteLine($"chunks with fewer than {Copies} replicas: " + string.Join(", ", need.Select(n => $"{n.Id} ({n.Live.Count})")));
foreach (var (id, live) in need)
{
    string target = Pick(1, live)[0];
    disks[target][id] = disks[live[0]][id]; // clone from a surviving replica
    where[id] = live.Append(target).ToList();
    Console.WriteLine($"re-replicate {id}: {live[0]} -> {target}");
}

Console.WriteLine("the master restarts and forgets where chunks are");
where = new Dictionary<string, List<string>>();
foreach (var s in servers.Where(alive.Contains))
    foreach (var id in disks[s].Keys)
    {
        if (!where.ContainsKey(id)) where[id] = new List<string>();
        where[id].Add(s); // each chunkserver reports its chunks
    }
Console.WriteLine($"rebuilt from reports: {where.Count} chunks, {where.Values.Sum(l => l.Count)} replicas, namespace from the operation log: {opLog.Count} entries");

string content = string.Concat(files["/logs/web"].Select(id => disks[where[id][0]][id]));
Console.WriteLine($"reader sees: {content} -> without padding: {content.Replace(".", "")}");
