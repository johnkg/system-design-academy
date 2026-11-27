// Claim Check in C#. The queue carries a small ticket; the heavy payload goes to storage.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var store = new BlobStore();
        var queue = new Queue<string>();

        // Producer: store the payload, send only the ticket
        var video = new Video("holiday.mp4", 20000);
        var ticket = store.Put(video);
        queue.Enqueue(ticket);
        Console.WriteLine($"Producer stored {video.SizeKb} KB as {ticket}");
        Console.WriteLine($"Queue message carries ticket {ticket} only");

        // Consumer: claim the payload with the ticket
        var claimed = queue.Dequeue();
        var payload = store.Get(claimed);
        Console.WriteLine($"Consumer fetched {claimed} ({payload.SizeKb} KB) and processed {payload.Name}");
        store.Delete(claimed); // only after success
        Console.WriteLine($"Consumer deleted {claimed}");

        Console.WriteLine($"Blobs left in the store: {store.Count}");
    }
}

public record Video(string Name, int SizeKb);

public class BlobStore // Payload store
{
    private readonly Dictionary<string, Video> _blobs = new();
    private int _next = 1;

    public string Put(Video payload)
    {
        var id = $"blob-{_next++}";
        _blobs[id] = payload;
        return id;
    }

    public Video Get(string id) => _blobs[id];
    public void Delete(string id) => _blobs.Remove(id);
    public int Count => _blobs.Count;
}
