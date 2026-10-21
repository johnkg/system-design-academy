// A message queue in C#: publish, receive, ack, retry, and a dead-letter queue.
using System;
using System.Collections.Generic;

public static class Program
{
    internal const int MaxAttempts = 3; // deliveries before a message goes to the dead-letter queue
    public static void Main()
    {
        var queue = new MessageQueue(MaxAttempts);
        foreach (var m in new[] { "email:ada", "email:BAD", "email:cy" }) queue.Publish(m); // the producer never waits

        Message? message;
        while ((message = queue.Receive()) is not null)
        {
            try
            {
                if (message.Body.Contains("BAD")) throw new InvalidOperationException("malformed address");
                queue.Ack(message.Id);
                Console.WriteLine($"ok     {message.Body}");
            }
            catch (Exception e)
            {
                Console.WriteLine($"failed {message.Body} (attempt {message.Attempts}): {e.Message}");
                queue.Nack(message.Id);
            }
        }
        Console.WriteLine("dead letters: [" + string.Join(", ", queue.DeadLetters.ConvertAll(m => m.Body)) + "]");
    }
}

public class Message(int id, string body)
{
    public int Id { get; } = id;
    public string Body { get; } = body;
    public int Attempts { get; set; }
}

public class MessageQueue(int maxAttempts = Program.MaxAttempts)
{
    private readonly Queue<Message> _ready = new();
    private readonly Dictionary<int, Message> _inFlight = new();
    private int _nextId = 1;
    public List<Message> DeadLetters { get; } = new();

    public void Publish(string body) => _ready.Enqueue(new Message(_nextId++, body));

    public Message? Receive() // hand a message to a worker; it stays "in flight" until acked or nacked
    {
        if (!_ready.TryDequeue(out var message)) return null;
        message.Attempts++;
        _inFlight[message.Id] = message;
        return message;
    }

    public void Ack(int id) => _inFlight.Remove(id); // done: delete it for good

    public void Nack(int id) // failed: try again later, or give up after too many attempts
    {
        var message = _inFlight[id];
        _inFlight.Remove(id);
        if (message.Attempts >= maxAttempts) DeadLetters.Add(message);
        else _ready.Enqueue(message);
    }
}
