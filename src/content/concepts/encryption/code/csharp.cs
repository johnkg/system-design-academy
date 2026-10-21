// Authenticated encryption (AES-256-GCM) in C#, with tamper detection.
// The key and nonce are fixed so the output is deterministic. Real code uses a random key from a key service
// and a NEW random nonce for every message: reusing a nonce with the same key breaks the security.
using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

public static class Program
{
    const int KeyBytes = 32; // 256-bit key
    const int NonceBytes = 12; // 96-bit nonce, the size GCM is designed for
    const int TagBytes = 16; // 128-bit authentication tag

    static readonly byte[] Key = Enumerable.Range(0, KeyBytes).Select(i => (byte)i).ToArray();
    static readonly byte[] Nonce = Enumerable.Range(0, NonceBytes).Select(i => (byte)(100 + i)).ToArray();

    static (byte[] Ciphertext, byte[] Tag) Encrypt(string plaintext)
    {
        var data = Encoding.UTF8.GetBytes(plaintext);
        var ciphertext = new byte[data.Length];
        var tag = new byte[TagBytes]; // the tag proves the data was not changed
        using var aes = new AesGcm(Key, tag.Length);
        aes.Encrypt(Nonce, data, ciphertext, tag);
        return (ciphertext, tag);
    }

    static string Decrypt(byte[] ciphertext, byte[] tag)
    {
        var plaintext = new byte[ciphertext.Length];
        using var aes = new AesGcm(Key, tag.Length);
        aes.Decrypt(Nonce, ciphertext, tag, plaintext); // throws if tampered
        return Encoding.UTF8.GetString(plaintext);
    }

    public static void Main()
    {
        var (ciphertext, tag) = Encrypt("meet at noon");
        Console.WriteLine($"ciphertext: {Convert.ToHexString(ciphertext).ToLowerInvariant()}");
        Console.WriteLine($"tag:        {Convert.ToHexString(tag).ToLowerInvariant()}");
        Console.WriteLine($"decrypted:  {Decrypt(ciphertext, tag)}");

        var tampered = (byte[])ciphertext.Clone();
        tampered[0] ^= 1; // an attacker flips one bit
        try { Decrypt(tampered, tag); }
        catch (CryptographicException) { Console.WriteLine("tampered:   authentication failed, data rejected"); }
    }
}
