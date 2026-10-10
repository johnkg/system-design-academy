// Ordering and de-duplicating chat messages in C#:
// the server numbers messages per conversation, ignores repeated client ids, and lets a client catch up after a sequence number.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var store = new ConversationStore();
        var chat = "alice+bob";

        Console.WriteLine($"alice sends 'hi':         {store.Append(chat, "alice", "m-901", "hi")}");
        // The acknowledgement was lost, so Alice's app sends the same message again with the same client id
        Console.WriteLine($"alice retries 'hi':       {store.Append(chat, "alice", "m-901", "hi")}");
        Console.WriteLine($"bob replies:              {store.Append(chat, "bob", "m-14", "hello!")}");
        Console.WriteLine($"alice sends 'lunch?':     {store.Append(chat, "alice", "m-902", "lunch?")}");

        // Bob was offline after message 1 and now reconnects, asking for everything after seq 1
        Console.WriteLine($"bob catches up after 1:   {string.Join(" | ", store.Since(chat, 1).Select(m => $"{m.Seq}:{m.Sender}:{m.Text}"))}");
    }
}

public record Message(int Seq, string Sender, string ClientId, string Text);

public record AppendResult(int Seq, bool Duplicate)
{
    public override string ToString() => $"{{ seq: {Seq}, duplicate: {(Duplicate ? "true" : "false")} }}";
}

public class ConversationStore
{
    private class Conversation
    {
        public List<Message> Messages { get; } = new();
        public Dictionary<string, int> ByClientId { get; } = new();
    }

    private readonly Dictionary<string, Conversation> _conversations = new();

    private Conversation Get(string id)
    {
        if (!_conversations.TryGetValue(id, out var conversation)) _conversations[id] = conversation = new Conversation();
        return conversation;
    }

    // Store a message once. A repeated client id (a retry) returns the original sequence number.
    public AppendResult Append(string conversationId, string sender, string clientId, string text)
    {
        var conversation = Get(conversationId);
        var key = $"{sender}:{clientId}";
        if (conversation.ByClientId.TryGetValue(key, out var existing)) return new AppendResult(existing, true);
        var seq = conversation.Messages.Count + 1; // the server decides the order, not the phone's clock
        conversation.Messages.Add(new Message(seq, sender, clientId, text));
        conversation.ByClientId[key] = seq;
        return new AppendResult(seq, false);
    }

    // Everything after a sequence number: how a reconnecting or offline client catches up
    public List<Message> Since(string conversationId, int afterSeq) => Get(conversationId).Messages.Where(m => m.Seq > afterSeq).ToList();
}
