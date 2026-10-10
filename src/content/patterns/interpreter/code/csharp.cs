// Interpreter in C#. A tiny postfix calculator: "x 3 * 2 +" means x*3+2.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        IExpression tree = Parser.Parse("x 3 * 2 +");
        Console.WriteLine(tree.Interpret(new() { ["x"] = 4 }));  // 14
        Console.WriteLine(tree.Interpret(new() { ["x"] = 10 })); // 32: same tree, new context
    }
}

public interface IExpression // Abstract Expression
{
    int Interpret(Dictionary<string, int> context);
}

public class NumberExpr(int value) : IExpression // Terminal Expression
{
    public int Interpret(Dictionary<string, int> context) => value;
}

public class VariableExpr(string name) : IExpression // Terminal Expression
{
    public int Interpret(Dictionary<string, int> context) => context[name];
}

public class AddExpr(IExpression left, IExpression right) : IExpression // Nonterminal Expression
{
    public int Interpret(Dictionary<string, int> context) => left.Interpret(context) + right.Interpret(context);
}

public class MultiplyExpr(IExpression left, IExpression right) : IExpression // Nonterminal Expression
{
    public int Interpret(Dictionary<string, int> context) => left.Interpret(context) * right.Interpret(context);
}

public static class Parser // builds the expression tree from text
{
    public static IExpression Parse(string postfix)
    {
        var stack = new Stack<IExpression>();
        foreach (var token in postfix.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (token is "+" or "*")
            {
                var right = stack.Pop();
                var left = stack.Pop();
                stack.Push(token == "+" ? new AddExpr(left, right) : new MultiplyExpr(left, right));
            }
            else if (int.TryParse(token, out int n)) stack.Push(new NumberExpr(n));
            else stack.Push(new VariableExpr(token));
        }
        return stack.Pop();
    }
}
