// Password hashing in C#: a fast unsalted hash versus a salted, slow one (PBKDF2).
// The salts are fixed so the output is deterministic. Real salts come from a secure random generator.
using System;
using System.Security.Cryptography;
using System.Text;

public static class Program
{
    const int Iterations = 100_000;
    const int KeyBytes = 32; // a 256-bit derived key

    static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();

    // Bad: one fast hash, no salt. Same password gives the same hash, and guesses are very cheap.
    static string FastHash(string password) => Hex(SHA256.HashData(Encoding.UTF8.GetBytes(password)));

    // Better: a unique salt per user and many iterations, so every guess is slow.
    static byte[] SlowHash(string password, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, KeyBytes);

    static bool Verify(string password, byte[] salt, byte[] stored) =>
        CryptographicOperations.FixedTimeEquals(SlowHash(password, salt), stored); // constant-time compare

    public static void Main()
    {
        Console.WriteLine("unsalted fast hash:");
        Console.WriteLine($"  alice: {FastHash("hunter2")[..24]}...");
        Console.WriteLine($"  bob:   {FastHash("hunter2")[..24]}...   <- identical, so one cracked guess breaks both");

        var aliceSalt = Convert.FromHexString("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
        var bobSalt = Convert.FromHexString("a1b2c3d4e5f60718293a4b5c6d7e8f90");
        var aliceStored = SlowHash("hunter2", aliceSalt);
        var bobStored = SlowHash("hunter2", bobSalt);

        Console.WriteLine("salted PBKDF2 (100000 iterations):");
        Console.WriteLine($"  alice: {Hex(aliceStored)[..24]}...");
        Console.WriteLine($"  bob:   {Hex(bobStored)[..24]}...   <- different, though the password is the same");

        Console.WriteLine($"alice logs in with hunter2: {Verify("hunter2", aliceSalt, aliceStored).ToString().ToLowerInvariant()}");
        Console.WriteLine($"alice logs in with wrong1:  {Verify("wrong1", aliceSalt, aliceStored).ToString().ToLowerInvariant()}");
    }
}
