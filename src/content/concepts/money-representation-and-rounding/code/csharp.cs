// Money as integers: minor units, one rounding rule, one rounding point, and exact splitting.
// Every printed value is an integer or a yes/no flag, so the three languages print identical text.
using System;
using System.Linq;

public static class Program
{
    // A cart of 6 lines: price in cents, quantity. Subtotal is 17808 cents.
    static readonly (long Price, long Qty)[] Lines = { (1410, 3), (2585, 1), (2507, 1), (3009, 1), (705, 3), (1681, 2) };

    static long Pow10(int n) { long p = 1; for (int i = 0; i < n; i++) p *= 10; return p; }

    // Divide num by den (both integers, den > 0) and round the result to a whole number with an explicit rule.
    static long DivRound(long num, long den, string mode)
    {
        long q = num / den;
        long r = num - q * den;
        if (mode == "trunc") return q;
        if (2 * r > den) return q + 1;
        if (2 * r < den) return q;
        return mode == "up" ? q + 1 : (q % 2 == 0 ? q : q + 1); // an exact tie: half up, or half even (banker's)
    }

    // The same rounding written the way float code usually does it: multiply the dollars by 100 and look at the fraction.
    static double FloatRound(double dollars, string mode)
    {
        double x = dollars * 100;
        long f = (long)Math.Floor(x);
        double d = x - f;
        long cents;
        if (mode == "trunc") cents = f;
        else if (d > 0.5) cents = f + 1;
        else if (d < 0.5) cents = f;
        else cents = mode == "up" ? f + 1 : (f % 2 == 0 ? f : f + 1);
        return cents / 100.0;
    }

    // Integer cart: rate in basis points (1000 = 10.00%). Tax is rounded per line or once on the subtotal.
    static (long Tax, long Total) IntegerCart(long bp, string point, string mode)
    {
        long subtotal = 0, tax = 0;
        foreach (var (price, qty) in Lines)
        {
            subtotal += price * qty;
            if (point == "line") tax += DivRound(price * qty * bp, 10000, mode);
        }
        if (point == "total") tax = DivRound(subtotal * bp, 10000, mode);
        return (tax, subtotal + tax);
    }

    // Float cart: prices held as dollars in binary floating point. Only the final answer is turned back into cents to print it.
    static (long Tax, long Total) FloatCart(long bp, string point, string mode)
    {
        double rate = (double)bp / 10000;
        double subtotal = 0, tax = 0;
        foreach (var (price, qty) in Lines)
        {
            double net = ((double)price / 100) * qty;
            subtotal += net;
            if (point == "line") tax += FloatRound(net * rate, mode);
        }
        if (point == "total") tax = FloatRound(subtotal * rate, mode);
        return ((long)Math.Floor(tax * 100 + 0.5), (long)Math.Floor((subtotal + tax) * 100 + 0.5));
    }

    // Split an amount by weights so the parts add up exactly: floor each share, then hand the leftover cents to the
    // largest fractional remainders (ties go to the earlier part).
    static long[] Allocate(long amount, long[] weights)
    {
        long sum = weights.Sum();
        long[] parts = weights.Select(w => amount * w / sum).ToArray();
        long[] rem = weights.Select(w => amount * w % sum).ToArray();
        long left = amount - parts.Sum();
        var order = Enumerable.Range(0, weights.Length).OrderByDescending(i => rem[i]).ThenBy(i => i).ToArray();
        foreach (int i in order)
        {
            if (left == 0) break;
            parts[i] += 1;
            left -= 1;
        }
        return parts;
    }

    // Convert minor units between currencies: the rate is held as an integer (rateE4 = rate x 10000), and we round once.
    static long Convert(long minor, int fromExp, int toExp, long rateE4, string mode) =>
        DivRound(minor * rateE4 * Pow10(toExp), Pow10(fromExp) * 10000, mode);

    // Show a minor-unit amount with its currency's exponent: 1234 is 12.34 in USD, 1234 in JPY, 1.234 in KWD.
    static string Show(long minor, int exp)
    {
        if (exp == 0) return minor.ToString();
        long p = Pow10(exp);
        return $"{minor / p}.{(minor % p).ToString().PadLeft(exp, '0')}";
    }

    public static void Main()
    {
        Console.WriteLine("-- binary floating point");
        double a = 0.1, b = 0.2, c = 0.3, ten = 0;
        long tenCents = 0;
        for (int i = 0; i < 10; i++) { ten += a; tenCents += 10; }
        Console.WriteLine($"0.1 + 0.2 equals 0.3: {(a + b == c ? 1 : 0)}");
        Console.WriteLine($"ten times 0.1 equals 1: {(ten == 1 ? 1 : 0)}; ten times 10 cents equals 100: {(tenCents == 100 ? 1 : 0)}");
        double price = 1.005;
        Console.WriteLine($"1.005 to cents, half up: float {(long)Math.Floor(price * 100 + 0.5)}, integer {DivRound(1005, 10, "up")}");

        Console.WriteLine("-- minor units and exponents");
        Console.WriteLine($"1234 in USD (exponent 2): {Show(1234, 2)}; JPY (0): {Show(1234, 0)}; KWD (3): {Show(1234, 3)}");

        Console.WriteLine("-- cart: 6 lines, subtotal 17808 cents");
        foreach (long bp in new long[] { 1000, 2000 })
            foreach (string point in new[] { "line", "total" })
                foreach (string mode in new[] { "up", "even", "trunc" })
                {
                    var (iTax, iTotal) = IntegerCart(bp, point, mode);
                    var (_, fTotal) = FloatCart(bp, point, mode);
                    string label = mode == "trunc" ? "truncated" : "half " + mode;
                    Console.WriteLine($"rate {bp} bp, round per {point}, {label}: integer tax {iTax} total {iTotal}; float total {fTotal}; float is off by {fTotal - iTotal}");
                }

        Console.WriteLine("-- splitting");
        foreach (int n in new[] { 3, 6 })
        {
            long each = DivRound(10000, n, "up");
            long naive = n * each;
            long[] parts = Allocate(10000, Enumerable.Repeat(1L, n).ToArray());
            Console.WriteLine($"10000 cents {n} ways: naive {each} each adds up to {naive} (off by {naive - 10000}); allocated {string.Join(" + ", parts)} = {parts.Sum()}");
        }
        Console.WriteLine($"10001 cents by weights 5:3:2: {string.Join(" + ", Allocate(10001, new long[] { 5, 3, 2 }))}");

        Console.WriteLine("-- converting the 6 line amounts (illustrative rates, rounded half up)");
        foreach (var (name, toExp, rateE4) in new[] { ("EUR", 2, 9137L), ("JPY", 0, 1492500L), ("KWD", 3, 3074L) })
        {
            long eachLine = Lines.Sum(l => Convert(l.Price * l.Qty, 2, toExp, rateE4, "up"));
            long once = Convert(17808, 2, toExp, rateE4, "up");
            Console.WriteLine($"{name}: convert each line then add {eachLine}; add then convert once {once}; difference {eachLine - once}");
        }
    }
}
