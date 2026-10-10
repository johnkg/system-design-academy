// Adapter in C#. The adapter implements IPaymentGateway and wraps the legacy API.
using System;

public static class Program
{
    public static void Main()
    {
        Checkout(new CardGateway(), 25m);
        Checkout(new LegacyBankAdapter(new LegacyBankApi()), 25m);
    }

    static void Checkout(IPaymentGateway gateway, decimal amount) => // Client
        Console.WriteLine(gateway.Pay(amount));
}

public interface IPaymentGateway // Target
{
    string Pay(decimal dollars);
}

public class CardGateway : IPaymentGateway // Target implementation
{
    public string Pay(decimal dollars) => $"Card charged ${dollars:F2}";
}

public record PaymentResult(bool Ok, string Ref);

public class LegacyBankApi // Adaptee: third-party, cannot be changed
{
    public PaymentResult MakePayment(int cents, string currency) =>
        new(true, $"LB-{cents}{currency}");
}

public class LegacyBankAdapter(LegacyBankApi bank) : IPaymentGateway // Adapter
{
    public string Pay(decimal dollars)
    {
        int cents = (int)Math.Round(dollars * 100);   // translate units
        var result = bank.MakePayment(cents, "USD");  // translate the call
        return result.Ok                              // translate the result
            ? $"Paid ${dollars:F2} (ref {result.Ref})"
            : "Payment failed";
    }
}
