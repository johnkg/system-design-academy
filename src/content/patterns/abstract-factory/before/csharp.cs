// Without the pattern: the form picks every widget's class itself.
using System;

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(RenderForm("light"));
        Console.WriteLine(RenderForm("dark"));
    }

    static string RenderForm(string theme)
    {
        // Every widget repeats the theme check. A third theme means editing this method
        // and every other place that builds widgets. Easy to mix families by mistake.
        var button = theme == "dark" ? (IButton)new DarkButton() : new LightButton();
        var checkbox = theme == "dark" ? (ICheckbox)new DarkCheckbox() : new LightCheckbox();
        return checkbox.Render("Remember me") + "\n" + button.Render("Sign in");
    }
}

public interface IButton { string Render(string label); }
public interface ICheckbox { string Render(string label); }
public class LightButton : IButton { public string Render(string l) => $"Light[ {l} ]"; }
public class LightCheckbox : ICheckbox { public string Render(string l) => $"Light[x] {l}"; }
public class DarkButton : IButton { public string Render(string l) => $"Dark< {l} >"; }
public class DarkCheckbox : ICheckbox { public string Render(string l) => $"Dark<x> {l}"; }
