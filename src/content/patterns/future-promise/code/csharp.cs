// Future/Promise in C#. Start both lookups, then wait for the futures (Tasks) together.
using System;
using System.Threading.Tasks;

public static class Program
{
    private static async Task<int> LookupPrice() // a Task<T> is the future of the value
    {
        await Task.Delay(150);
        return 40;
    }

    private static async Task<int> LookupStock(bool fails)
    {
        await Task.Delay(100);
        if (fails) throw new InvalidOperationException("stock service down");
        return 7;
    }

    private static async Task Show(bool stockFails)
    {
        Console.WriteLine("started price and stock lookups");
        var price = LookupPrice(); // the work has begun, the value is not here yet
        var stock = LookupStock(stockFails);

        try
        {
            await Task.WhenAll(price, stock); // wait for both
            Console.WriteLine($"price {price.Result}, stock {stock.Result}");
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine($"stock failed: {stock.Exception!.InnerException!.Message}");
            Console.WriteLine($"price still arrived: {price.Result}");
        }
    }

    public static async Task Main()
    {
        await Show(false);
        await Show(true);
    }
}
