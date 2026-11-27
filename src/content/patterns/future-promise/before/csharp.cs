// Without the pattern: each lookup is awaited before the next one starts, and one failure loses everything.
using System;
using System.Threading.Tasks;

public static class Program
{
    private static async Task<int> LookupPrice() { await Task.Delay(150); return 40; }

    private static async Task<int> LookupStock(bool fails)
    {
        await Task.Delay(100);
        if (fails) throw new InvalidOperationException("stock service down");
        return 7;
    }

    private static async Task Show(bool stockFails)
    {
        try
        {
            Console.WriteLine("asked for the price, waiting...");
            var price = await LookupPrice(); // nothing else happens during this wait
            Console.WriteLine($"got price {price}");
            Console.WriteLine("asked for the stock, waiting...");
            var stock = await LookupStock(stockFails); // only now does the second lookup start
            Console.WriteLine($"got stock {stock}");
        }
        catch (InvalidOperationException error)
        {
            Console.WriteLine($"page failed: {error.Message}"); // the page fails, and the price that had arrived is thrown away
        }
    }

    public static async Task Main()
    {
        await Show(false);
        await Show(true);
    }
}
