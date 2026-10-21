// The core of a login service, in C# (single file, .NET 10, standard library only):
// a slow salted password hash, a one-time code (TOTP, RFC 6238), and refresh tokens that rotate and detect theft.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

static string Lower(bool b) => b ? "true" : "false";

// 1. Slow salted hash. Every user has their own salt, and the iteration count is the price an attacker pays per guess.
const int Iterations = 20000;
const int KeyBytes = 32; // a 256-bit derived key
const int TotpStepSeconds = 30, TotpDigits = 6;
const int RfcDigits = 8; // the RFC 6238 test vectors use 8-digit codes
static string HashPassword(string password, string salt) =>
    Convert.ToHexString(Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), Encoding.UTF8.GetBytes(salt), Iterations, HashAlgorithmName.SHA256, KeyBytes)).ToLowerInvariant();
static bool VerifyPassword(string password, string salt, string stored) =>
    CryptographicOperations.FixedTimeEquals(Convert.FromHexString(HashPassword(password, salt)), Convert.FromHexString(stored));

// 2. TOTP: HMAC of the number of 30-second steps since 1970, cut down to a few digits (dynamic truncation).
static string Totp(byte[] secret, long seconds, int digits)
{
    var counter = BitConverter.GetBytes((ulong)(seconds / TotpStepSeconds));
    if (BitConverter.IsLittleEndian) Array.Reverse(counter);
    var mac = HMACSHA1.HashData(secret, counter);
    int offset = mac[19] & 15;
    uint value = ((uint)mac[offset] << 24 | (uint)mac[offset + 1] << 16 | (uint)mac[offset + 2] << 8 | mac[offset + 3]) & 0x7FFFFFFF;
    return (value % (uint)Math.Pow(10, digits)).ToString().PadLeft(digits, '0');
}
// Accept the previous, current and next step, because phone clocks drift.
static bool VerifyTotp(byte[] secret, long seconds, string given) => new long[] { -TotpStepSeconds, 0, TotpStepSeconds }.Any(d => Totp(secret, seconds + d, TotpDigits) == given);

var salt = "a1b2c3d4e5f60718";
var stored = HashPassword("correct horse battery", salt);
Console.WriteLine($"hash: {stored[..16]}");
Console.WriteLine($"right password: {Lower(VerifyPassword("correct horse battery", salt, stored))}, wrong password: {Lower(VerifyPassword("correct horse batterz", salt, stored))}");
Console.WriteLine($"same password, another salt gives another hash: {Lower(HashPassword("correct horse battery", "ffffffffffffffff") != stored)}");

var secret = Encoding.ASCII.GetBytes("12345678901234567890");
Console.WriteLine($"totp rfc vectors: {Totp(secret, 59, RfcDigits)} {Totp(secret, 1111111109, RfcDigits)} {Totp(secret, 1234567890, RfcDigits)}");
long now = 1700000010;
var code = Totp(secret, now, TotpDigits);
Console.WriteLine($"code {code}: now {Lower(VerifyTotp(secret, now, code))}, 30s late {Lower(VerifyTotp(secret, now + TotpStepSeconds, code))}, 90s late {Lower(VerifyTotp(secret, now + 90, code))}");

// 3. Refresh tokens rotate: each one is used once and replaced. Using an old one means a copy was stolen, so the whole family dies.
var svc = new TokenService("server-key");
var r1 = svc.Login("ann");
var r2 = svc.Refresh(r1).Token!;
var r3 = svc.Refresh(r2).Token!;
var replay = svc.Refresh(r1);
var after = svc.Refresh(r3);
Console.WriteLine($"replay of r1: {replay.Why}; newest token afterwards: {after.Why}");
var other = svc.Refresh(svc.Login("bob"));
Console.WriteLine($"another user is unaffected: {Lower(other.Ok)}");

if (Totp(secret, 59, RfcDigits) != "94287082" || Totp(secret, 1111111109, RfcDigits) != "07081804" || Totp(secret, 1234567890, RfcDigits) != "89005924") Environment.Exit(1);
if (replay.Ok || after.Ok || !other.Ok || VerifyPassword("correct horse batterz", salt, stored)) Environment.Exit(1);

record Result(bool Ok, string? Token = null, string? Why = null);

class TokenService(string key)
{
    const int TokenHexChars = 12;
    static string Sha256(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
    int counter;
    readonly Dictionary<string, (string Family, bool Used)> byHash = new();
    readonly Dictionary<string, string> families = new();

    string Mint(string family) // the server stores only the hash of a token, like a password
    {
        var token = Sha256($"{key}:{++counter}")[..TokenHexChars];
        byHash[Sha256(token)] = (family, false);
        return token;
    }

    public string Login(string user) { families[user] = "alive"; return Mint(user); }

    public Result Refresh(string token)
    {
        if (!byHash.TryGetValue(Sha256(token), out var rec)) return new Result(false, Why: "unknown");
        if (families[rec.Family] != "alive") return new Result(false, Why: "family revoked");
        if (rec.Used) { families[rec.Family] = "revoked"; return new Result(false, Why: "reuse detected, family revoked"); }
        byHash[Sha256(token)] = (rec.Family, true);
        return new Result(true, Token: Mint(rec.Family));
    }
}
