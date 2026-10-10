// Without the pattern: parsing and calculating tangled in one method.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Evaluate("x 3 * 2 +", new() { ["x"] = 4 }));
        Console.WriteLine(Evaluate("x 3 * 2 +", new() { ["x"] = 10 })); // re-parses the text every time
    }

    static int Evaluate(string postfix, Dictionary<string, int> vars)
    {
        var stack = new Stack<int>();
        foreach (var token in postfix.Split(' '))
        {
            if (token == "+") { int b = stack.Pop(), a = stack.Pop(); stack.Push(a + b); }
            else if (token == "*") { int b = stack.Pop(), a = stack.Pop(); stack.Push(a * b); }
            else if (int.TryParse(token, out int n)) stack.Push(n);
            else stack.Push(vars[token]);
            // New operator "-"? Another branch here. Want to print the formula? No structure to walk.
        }
        return stack.Pop();
    }
}
