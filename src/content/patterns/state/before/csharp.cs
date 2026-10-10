// Without the pattern: every method branches on a status string.
using System;

public static class Program
{
    public static void Main()
    {
        var doc = new Document();
        Console.WriteLine($"{doc.Edit()} | {doc.Publish()} | {doc.Status}");
    }
}

public class Document
{
    public string Status { get; private set; } = "draft";

    public string Edit() => Status switch
    {
        "draft" => "Editing the draft",
        "review" => "Cannot edit while in review",
        _ => "Cannot edit a published document",
    };

    public string Publish()
    {
        if (Status == "draft") { Status = "review"; return "Sent to review"; }
        if (Status == "review") { Status = "published"; return "Approved and published"; }
        return "Already published";
    }

    public string Reject()
    {
        if (Status == "draft") return "A draft has nothing to reject";
        Status = "draft";
        return "Back to draft";
    }
    // Add an "archived" state: edit every method above, and hope you do not miss one.
}
