// Observer in C#. Classic interface version; see IObservable<T> / events for built-in options.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var channel = new NewsChannel();
        var email = new EmailSubscriber("ada@example.com");
        channel.Subscribe(email);
        channel.Subscribe(new SmsSubscriber("+1-555-0100"));

        channel.Publish("Pattern of the day: Observer"); // both are notified
        channel.Unsubscribe(email);
        channel.Publish("Second headline");              // only SMS is notified
    }
}

public interface IObserver // Observer
{
    void Update(string headline);
}

public class NewsChannel // Subject
{
    private readonly List<IObserver> _subscribers = new();

    public void Subscribe(IObserver observer) => _subscribers.Add(observer);
    public void Unsubscribe(IObserver observer) => _subscribers.Remove(observer);

    public void Publish(string headline)
    {
        // Copy so observers may unsubscribe during notification.
        foreach (var observer in _subscribers.ToArray()) observer.Update(headline);
    }
}

public class EmailSubscriber(string address) : IObserver // Concrete Observer
{
    public void Update(string headline) => Console.WriteLine($"Email to {address}: {headline}");
}

public class SmsSubscriber(string number) : IObserver // Concrete Observer
{
    public void Update(string headline) => Console.WriteLine($"SMS to {number}: {headline}");
}
