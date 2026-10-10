// Without the pattern: the client loops over the playlist's internal list.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var playlist = new Playlist();

        for (int i = 0; i < playlist.Songs.Count; i++) Console.WriteLine(playlist.Songs[i]);

        // Reverse needs different index math, copied into every place that wants it:
        for (int i = playlist.Songs.Count - 1; i >= 0; i--) Console.WriteLine(playlist.Songs[i]);

        // If Playlist switches to a linked list or a database cursor, every loop above breaks.
    }
}

public class Playlist
{
    public List<string> Songs { get; } = new() { "Intro", "Verse", "Chorus" }; // exposed so callers can loop over it
}
