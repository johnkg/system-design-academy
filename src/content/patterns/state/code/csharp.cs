// State in C#. Each state class decides what each action does.
using System;

public static class Program
{
    public static void Main()
    {
        var doc = new Document();
        Console.WriteLine($"{doc.StateName} -> {doc.Edit()}");    // Draft -> Editing the draft
        Console.WriteLine($"{doc.Publish()} | {doc.StateName}");  // Sent to review | Review
        Console.WriteLine(doc.Edit());                            // Cannot edit while in review
        Console.WriteLine($"{doc.Publish()} | {doc.StateName}");  // Approved and published | Published
        Console.WriteLine($"{doc.Reject()} | {doc.StateName}");   // Unpublished: back to draft | Draft
    }
}

public interface IDocState // State
{
    string Edit(Document doc);
    string Publish(Document doc);
    string Reject(Document doc);
}

public class Draft : IDocState // Concrete State
{
    public string Edit(Document doc) => "Editing the draft";
    public string Publish(Document doc) { doc.SetState(new Review()); return "Sent to review"; }
    public string Reject(Document doc) => "A draft has nothing to reject";
}

public class Review : IDocState // Concrete State
{
    public string Edit(Document doc) => "Cannot edit while in review";
    public string Publish(Document doc) { doc.SetState(new Published()); return "Approved and published"; }
    public string Reject(Document doc) { doc.SetState(new Draft()); return "Sent back to draft"; }
}

public class Published : IDocState // Concrete State
{
    public string Edit(Document doc) => "Cannot edit a published document";
    public string Publish(Document doc) => "Already published";
    public string Reject(Document doc) { doc.SetState(new Draft()); return "Unpublished: back to draft"; }
}

public class Document // Context: delegates everything to the current state
{
    private IDocState _state = new Draft();
    public void SetState(IDocState state) => _state = state;
    public string StateName => _state.GetType().Name;
    public string Edit() => _state.Edit(this);
    public string Publish() => _state.Publish(this);
    public string Reject() => _state.Reject(this);
}
