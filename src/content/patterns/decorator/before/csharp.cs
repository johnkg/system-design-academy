// Without the pattern: a subclass for every combination.
using System;

public static class Program
{
    public static void Main()
    {
        var drink = new EspressoWithMilkAndMocha();
        Console.WriteLine($"{drink.Description} = ${drink.Cost:F2}");
    }
}

public class Espresso
{
    public virtual string Description => "Espresso";
    public virtual decimal Cost => 2.0m;
}
public class EspressoWithMilk : Espresso
{
    public override string Description => "Espresso, milk";
    public override decimal Cost => 2.5m;
}
public class EspressoWithMocha : Espresso
{
    public override string Description => "Espresso, mocha";
    public override decimal Cost => 2.7m;
}
public class EspressoWithMilkAndMocha : Espresso
{
    public override string Description => "Espresso, milk, mocha";
    public override decimal Cost => 3.2m;
}
// ...and EspressoWithWhip, EspressoWithMilkAndWhip, EspressoWithMochaAndWhip,
// EspressoWithMilkMochaAndWhip, EspressoWithDoubleMocha... Prices are copied everywhere.
