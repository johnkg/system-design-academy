// Without the pattern: the channel is hard-wired to every recipient.
using System;

public static class Program
{
    public static void Main() => new NewsChannel().Publish("Pattern of the day: Observer");
}

public class EmailSender
{
    public void Send(string headline) => Console.WriteLine($"Email to ada@example.com: {headline}");
}

public class SmsSender
{
    public void Send(string headline) => Console.WriteLine($"SMS to +1-555-0100: {headline}");
}

public class NewsChannel
{
    private readonly EmailSender _email = new(); // concrete types baked in
    private readonly SmsSender _sms = new();

    public void Publish(string headline)
    {
        _email.Send(headline);
        _sms.Send(headline);
        // Want push notifications? Edit this class. Want to unsubscribe? You can't.
    }
}
