// Generating short codes in C#: a counter, scrambled so it is not guessable, encoded in base62.
using System;
using System.Collections.Generic;
using System.Numerics;
using System.Text;

public static class Program
{
    const string Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const int Base = 62; // digits, lower case and upper case letters
    const int Length = 7;
    static readonly BigInteger Space = BigInteger.Pow(Base, Length); // 3,521,614,606,208 distinct 7-character codes
    static readonly BigInteger Multiplier = BigInteger.Parse("1442695040888963407"); // odd and not a multiple of 31, so it shares no factor with 62^7

    static string Encode(BigInteger number)
    {
        var code = new StringBuilder();
        for (var n = number; n > 0; n /= Base) code.Insert(0, Alphabet[(int)(n % Base)]);
        return code.ToString().PadLeft(Length, '0');
    }

    static BigInteger Decode(string code)
    {
        BigInteger n = 0;
        foreach (var ch in code) n = n * Base + Alphabet.IndexOf(ch);
        return n;
    }

    // Multiplying by a number that shares no factor with Space maps every id to a different value,
    // so codes stay unique but consecutive ids no longer look consecutive.
    static BigInteger Scramble(BigInteger id) => (id * Multiplier) % Space;

    static string ShortCode(long id) => Encode(Scramble(id));

    public static void Main()
    {
        const int Sample = 125, IdCount = 100000;
        Console.WriteLine($"plain base62 of 125:   {Encode(Sample)}");
        Console.WriteLine($"round trip of 125:     {Decode(Encode(Sample))}");
        foreach (var id in new long[] { 1, 2, 3 }) Console.WriteLine($"id {id} becomes code:   {ShortCode(id)}");

        var codes = new HashSet<string>();
        for (long id = 1; id <= IdCount; id++) codes.Add(ShortCode(id));
        Console.WriteLine($"100000 ids gave {codes.Count} distinct codes");
        Console.WriteLine($"7 characters allow {Space} links");
    }
}
