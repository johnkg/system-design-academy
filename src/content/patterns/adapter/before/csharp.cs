// Without the pattern: checkout knows every vendor's API and units.
using System;

public static class Program
{
    public static void Main()
    {
        Checkout("card", 25m);
        Checkout("legacy", 25m);
    }

    static void Checkout(string provider, decimal amount)
    {
        if (provider == "card")
        {
            Console.WriteLine(new CardGateway().Pay(amount));
        }
        else if (provider == "legacy")
        {
            // Unit conversion and result handling copied wherever the bank is used.
            var result = new LegacyBankApi().MakePayment((int)Math.Round(amount * 100), "USD");
            Console.WriteLine(result.Ok ? $"Paid ${amount:F2} (ref {result.Ref})" : "Payment failed");
        }
        // Another provider? Another branch, with its own units and quirks.
    }
}

public class CardGateway
{
    public string Pay(decimal dollars) => $"Card charged ${dollars:F2}";
}

public record PaymentResult(bool Ok, string Ref);

public class LegacyBankApi
{
    public PaymentResult MakePayment(int cents, string currency) => new(true, $"LB-{cents}{currency}");
}
