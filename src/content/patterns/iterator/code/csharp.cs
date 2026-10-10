// Iterator in C#. Hand-written for teaching; C# also has IEnumerable<T> and yield return.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var playlist = new Playlist().Add("Intro").Add("Verse").Add("Chorus");

        var forward = playlist.CreateIterator(); // Client
        while (forward.HasNext()) Console.WriteLine(forward.Next()); // Intro, Verse, Chorus

        var reverse = playlist.CreateReverseIterator();
        var other = playlist.CreateIterator();                       // independent position
        Console.WriteLine($"{reverse.Next()} {other.Next()}");       // Chorus Intro
    }
}

public interface ISongIterator // Iterator
{
    bool HasNext();
    string Next();
}

public class ForwardIterator(List<string> songs) : ISongIterator // Concrete Iterator
{
    private int _index;
    public bool HasNext() => _index < songs.Count;
    public string Next() => songs[_index++];
}

public class ReverseIterator(List<string> songs) : ISongIterator // Concrete Iterator
{
    private int _index = songs.Count - 1;
    public bool HasNext() => _index >= 0;
    public string Next() => songs[_index--];
}

public class Playlist // Aggregate: hides how songs are stored
{
    private readonly List<string> _songs = new();
    public Playlist Add(string song) { _songs.Add(song); return this; }
    public ISongIterator CreateIterator() => new ForwardIterator(_songs);
    public ISongIterator CreateReverseIterator() => new ReverseIterator(_songs);
}
