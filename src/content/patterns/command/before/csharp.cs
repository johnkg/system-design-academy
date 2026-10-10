// Without the pattern: buttons change the document directly. No history, no undo.
using System;

public static class Program
{
    static string _text = "";

    public static void Main()
    {
        OnInsertClick("Hello");
        OnInsertClick(" world");
        OnUppercaseClick();
        Console.WriteLine(_text); // HELLO WORLD

        // Undo? Nothing remembers what was done or what the text looked like before.
        // Adding undo means editing every handler to save state in some ad-hoc way.
    }

    static void OnInsertClick(string text) => _text += text;
    static void OnUppercaseClick() => _text = _text.ToUpper();
}
