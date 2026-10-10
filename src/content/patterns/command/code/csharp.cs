// Command in C#. Actions become objects with Execute() and Undo().
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var doc = new Document();
        var history = new History();

        history.Run(new InsertCommand(doc, "Hello"));
        history.Run(new InsertCommand(doc, " world"));
        history.Run(new UppercaseCommand(doc));
        Console.WriteLine(doc.Text); // HELLO WORLD
        history.Undo();
        Console.WriteLine(doc.Text); // Hello world
        history.Undo();
        Console.WriteLine(doc.Text); // Hello
        history.Redo();
        Console.WriteLine(doc.Text); // Hello world
    }
}

public class Document { public string Text { get; set; } = ""; } // Receiver

public interface ICommand // Command
{
    void Execute();
    void Undo();
}

public class InsertCommand(Document doc, string text) : ICommand // Concrete Command
{
    public void Execute() => doc.Text += text;
    public void Undo() => doc.Text = doc.Text[..^text.Length];
}

public class UppercaseCommand(Document doc) : ICommand // Concrete Command
{
    private string _before = "";
    public void Execute() { _before = doc.Text; doc.Text = doc.Text.ToUpper(); }
    public void Undo() => doc.Text = _before; // remember state so we can restore it
}

public class History // Invoker
{
    private readonly Stack<ICommand> _done = new();
    private readonly Stack<ICommand> _undone = new();

    public void Run(ICommand command)
    {
        command.Execute();
        _done.Push(command);
        _undone.Clear(); // a new action clears the redo stack
    }

    public void Undo() { if (_done.TryPop(out var c)) { c.Undo(); _undone.Push(c); } }
    public void Redo() { if (_undone.TryPop(out var c)) { c.Execute(); _done.Push(c); } }
}
