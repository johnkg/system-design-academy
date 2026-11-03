// A miniature of Haystack from Facebook's "Needle in a haystack: efficient storage of billions of photos" (2009), in C#
// (a teaching model, not Facebook's code): photos are needles appended to one big store file, an in-memory index maps a photo and
// size to the needle's offset so a read costs one disk I/O, a delete only sets a flag, compaction copies the live needles into
// a new store file, and a restarted server rebuilds its index from the store. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

var sizes = new Dictionary<string, int> { ["large"] = 100, ["medium"] = 40, ["small"] = 20, ["thumb"] = 8 }; // bytes of image data per size (made up)
const int Header = 16, Footer = 8; // bytes of needle overhead (made up)
const int NfsReads = 3; // directory lookup, inode read and data read when the metadata is not cached (a simple assumption)
var store = new List<Needle>(); // the append-only store file: needles in the order they were written
var index = new Dictionary<string, int>(); // in memory: "photo/size" -> offset of the needle in the store file
int bytes = 0, diskReads = 0;

void Put(int photo, string size)
{
    var needle = new Needle(photo, size, sizes[size], bytes);
    bytes += Header + needle.Length + Footer;
    store.Add(needle);
    index[$"{photo}/{size}"] = needle.Offset;
}

string Read(int photo, string size)
{
    if (!index.TryGetValue($"{photo}/{size}", out var offset))
        return $"photo {photo} {size}: not found (the index answered, no disk read)";
    diskReads++; // one read of the needle at a known offset
    var needle = store.First(n => n.Offset == offset);
    return $"photo {photo} {size}: {needle.Length} bytes from offset {offset} (1 disk read)";
}

foreach (var photo in new[] { 1, 2, 3 }) foreach (var size in sizes.Keys) Put(photo, size);
Console.WriteLine($"uploaded 3 photos in 4 sizes: {store.Count} needles, store file {bytes} bytes, index entries {index.Count}");
Console.WriteLine(Read(2, "medium"));
Console.WriteLine($"without an in-memory index a file-per-photo layout needs about {NfsReads} disk reads for the same photo");
for (int i = 0; i < 100; i++) Read(3, "thumb");
Console.WriteLine($"100 thumbnail reads: {diskReads - 1} disk reads, against about {100 * NfsReads} in the file-per-photo layout");

foreach (var size in sizes.Keys) // delete photo 2: set the flag and drop it from the index; the bytes stay in the file
{
    foreach (var n in store.Where(n => n.Photo == 2 && n.Size == size)) n.Deleted = true;
    index.Remove($"2/{size}");
}
Console.WriteLine(Read(2, "medium"));
Console.WriteLine($"after the delete the store file is still {bytes} bytes, with {store.Count(n => n.Deleted)} flagged needles");

index = new Dictionary<string, int>();
foreach (var n in store.Where(n => !n.Deleted)) index[$"{n.Photo}/{n.Size}"] = n.Offset; // after a restart the index is rebuilt from the store
Console.WriteLine($"restart: index rebuilt from the store file with {index.Count} live entries");

var live = store.Where(n => !n.Deleted).ToList();
store = new List<Needle>(); bytes = 0; index = new Dictionary<string, int>();
foreach (var n in live) Put(n.Photo, n.Size); // compaction: copy live needles into a new store file
Console.WriteLine($"compaction: new store file {bytes} bytes with {store.Count} needles");
Console.WriteLine(Read(3, "thumb"));

class Needle
{
    public int Photo { get; }
    public string Size { get; }
    public int Length { get; }
    public int Offset { get; }
    public bool Deleted { get; set; }
    public Needle(int photo, string size, int length, int offset) { Photo = photo; Size = size; Length = length; Offset = offset; }
}
