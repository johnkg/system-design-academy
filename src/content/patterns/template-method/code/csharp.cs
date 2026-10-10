// Template Method in C#. Prepare() fixes the order; subclasses fill in steps.
using System;

public static class Program
{
    public static void Main()
    {
        new Tea().Prepare();
        Console.WriteLine("---");
        new Coffee().Prepare();
    }
}

public abstract class Beverage // Abstract Class
{
    public void Prepare() // the template method: not virtual, so it cannot be overridden
    {
        BoilWater();
        Brew();
        Pour();
        if (WantsCondiments()) AddCondiments();
    }

    private void BoilWater() => Console.WriteLine("Boiling water");   // shared step
    private void Pour() => Console.WriteLine("Pouring into cup");      // shared step
    protected abstract void Brew();                                    // variable step
    protected abstract void AddCondiments();
    protected virtual bool WantsCondiments() => true;                  // hook: optional override
}

public class Tea : Beverage // Concrete Class
{
    protected override void Brew() => Console.WriteLine("Steeping the tea bag");
    protected override void AddCondiments() => Console.WriteLine("Adding lemon");
}

public class Coffee : Beverage // Concrete Class
{
    protected override void Brew() => Console.WriteLine("Dripping coffee through the filter");
    protected override void AddCondiments() => Console.WriteLine("Adding sugar and milk");
    protected override bool WantsCondiments() => false; // this coffee is served black
}
