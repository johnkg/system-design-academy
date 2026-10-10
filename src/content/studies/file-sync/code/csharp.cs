// Syncing a file by chunks in C#:
// the file is cut where its own content says so, each chunk is stored under its hash, and only chunks the server lacks are uploaded.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;

public static class Program
{
    const int Min = 1024, AvgBits = 12, Max = 16384; // chunks average about 4 KB (2^12 bytes), and are never under 1 KB or over 16 KB
    const int Fixed = 4096;

    static long seed = 7; // a small repeatable random generator, so every run sees the same file
    static long NextRandom() => seed = (seed * 1664525 + 1013904223) % 4294967296;
    static uint[] gear = Array.Empty<uint>(); // a random number for each possible byte value
    static byte[] RandomBytes(int n) => Enumerable.Range(0, n).Select(_ => (byte)((NextRandom() >> 16) & 255)).ToArray();

    // Content-defined chunking: roll a hash along the bytes and end a chunk when its top bits are all zero.
    // The cut points depend on the last few dozen bytes only, so they move with the content when something is inserted before them.
    static List<byte[]> ChunkByContent(byte[] data)
    {
        uint mask = ((1u << AvgBits) - 1) << (32 - AvgBits);
        var chunks = new List<byte[]>();
        int start = 0; uint h = 0;
        for (int i = 0; i < data.Length; i++)
        {
            h = (h << 1) + gear[data[i]];
            int size = i - start + 1;
            if ((size >= Min && (h & mask) == 0) || size >= Max)
            {
                chunks.Add(data[start..(i + 1)]); start = i + 1; h = 0;
            }
        }
        if (start < data.Length) chunks.Add(data[start..]);
        return chunks;
    }

    static List<byte[]> ChunkFixed(byte[] data)
    {
        var chunks = new List<byte[]>();
        for (int i = 0; i < data.Length; i += Fixed) chunks.Add(data[i..Math.Min(i + Fixed, data.Length)]);
        return chunks;
    }

    // The server keeps every chunk it has seen, by hash. Uploading a file means sending only the chunks it does not hold yet.
    static long Sync(Dictionary<string, int> server, List<byte[]> chunks)
    {
        long sent = 0;
        foreach (var chunk in chunks)
        {
            string key = Convert.ToHexString(SHA256.HashData(chunk));
            if (server.TryAdd(key, chunk.Length)) sent += chunk.Length;
        }
        return sent;
    }

    public static int Main()
    {
        gear = Enumerable.Range(0, 256).Select(_ => (uint)NextRandom()).ToArray();
        var original = RandomBytes(300000);
        var edited = RandomBytes(10).Concat(original).ToArray(); // 10 bytes inserted at the very start

        int failures = 0;
        foreach (var (name, chunker, limitHigh) in new (string, Func<byte[], List<byte[]>>, bool)[] { ("fixed 4 KB chunks", ChunkFixed, true), ("content-defined chunks", ChunkByContent, false) })
        {
            var server = new Dictionary<string, int>();
            long first = Sync(server, chunker(original));
            long second = Sync(server, chunker(edited));
            double share = second * 100.0 / edited.Length;
            Console.WriteLine($"{name}: first upload {first} bytes, after inserting 10 bytes at the start {second} bytes ({share:0.0}% of the file)");
            if (limitHigh && share < 90) failures++; // fixed chunks: every boundary moved, so nearly everything is sent again
            if (!limitHigh && share > 10) failures++; // content-defined: only the chunk around the edit is sent
        }
        return failures > 0 ? 1 : 0;
    }
}
