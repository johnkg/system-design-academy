// Abstract Factory in C#. The factory interface has one method per product.
using System;

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(RenderForm(new LightFactory()));
        Console.WriteLine(RenderForm(new DarkFactory())); // same code, a whole different family
    }

    static string RenderForm(IGuiFactory factory) // Client
    {
        IButton button = factory.CreateButton();
        ICheckbox checkbox = factory.CreateCheckbox();
        return checkbox.Render("Remember me") + "\n" + button.Render("Sign in");
    }
}

public interface IButton { string Render(string label); }       // Product
public interface ICheckbox { string Render(string label); }     // Product

public interface IGuiFactory // Abstract Factory
{
    IButton CreateButton();
    ICheckbox CreateCheckbox();
}

public class LightButton : IButton { public string Render(string l) => $"Light[ {l} ]"; }   // Concrete Product
public class LightCheckbox : ICheckbox { public string Render(string l) => $"Light[x] {l}"; }
public class DarkButton : IButton { public string Render(string l) => $"Dark< {l} >"; }
public class DarkCheckbox : ICheckbox { public string Render(string l) => $"Dark<x> {l}"; }

public class LightFactory : IGuiFactory // Concrete Factory
{
    public IButton CreateButton() => new LightButton();
    public ICheckbox CreateCheckbox() => new LightCheckbox();
}

public class DarkFactory : IGuiFactory // Concrete Factory
{
    public IButton CreateButton() => new DarkButton();
    public ICheckbox CreateCheckbox() => new DarkCheckbox();
}
