// Signed tokens in C#: create, verify the signature and expiry, then authorize.
// A fixed secret and clock make the demo deterministic. Real systems use a vetted library and managed keys.
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public static class Program
{
    const string Secret = "demo-secret-do-not-use-in-production";
    const long Now = 1000; // the demo clock, in seconds
    const long ExpiresAt = 2000; // when the demo tokens expire
    const long AfterExpiry = 2500;

    static string B64(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    static string B64Bytes(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    static string Decode(string value)
    {
        var s = value.Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        return Encoding.UTF8.GetString(Convert.FromBase64String(s));
    }
    static string Sign(string data) => B64Bytes(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.UTF8.GetBytes(data)));

    static string CreateToken(string user, string role, long expiresAt)
    {
        var header = B64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
        var payload = B64($"{{\"sub\":\"{user}\",\"role\":\"{role}\",\"exp\":{expiresAt}}}");
        return $"{header}.{payload}.{Sign($"{header}.{payload}")}";
    }

    // Authentication: is this token genuine and still valid? Returns the claims, or throws.
    static (string Sub, string Role) Authenticate(string token, long now)
    {
        var parts = token.Split('.');
        var expected = Encoding.UTF8.GetBytes(Sign($"{parts[0]}.{parts[1]}"));
        var given = Encoding.UTF8.GetBytes(parts[2]);
        if (!CryptographicOperations.FixedTimeEquals(expected, given)) throw new Exception("401 invalid signature");
        using var doc = JsonDocument.Parse(Decode(parts[1]));
        if (doc.RootElement.GetProperty("exp").GetInt64() <= now) throw new Exception("401 token expired");
        return (doc.RootElement.GetProperty("sub").GetString()!, doc.RootElement.GetProperty("role").GetString()!);
    }

    // Authorization: may this known caller do this?
    static string Authorize((string Sub, string Role) claims, string action, string? owner)
    {
        if (action == "list-users" && claims.Role != "admin") throw new Exception("403 admins only");
        if (action == "read-order" && claims.Role != "admin" && claims.Sub != owner) throw new Exception("403 not your order");
        return "200 ok";
    }

    static void Call(string label, string token, string action, string? owner = null, long now = Now)
    {
        try
        {
            var claims = Authenticate(token, now);
            Console.WriteLine($"{label}: {Authorize(claims, action, owner)} ({claims.Sub})");
        }
        catch (Exception e) { Console.WriteLine($"{label}: {e.Message}"); }
    }

    public static void Main()
    {
        var alice = CreateToken("alice", "customer", ExpiresAt);
        var bob = CreateToken("bob", "admin", ExpiresAt);

        Call("alice reads her order   ", alice, "read-order", "alice");
        Call("alice reads bob's order ", alice, "read-order", "bob");
        Call("alice lists all users   ", alice, "list-users");
        Call("bob lists all users     ", bob, "list-users");
        Call("alice, after expiry     ", alice, "read-order", "alice", AfterExpiry);

        // Alice edits her own token to say she is an admin, but she cannot re-sign it
        var parts = alice.Split('.');
        var forged = $"{parts[0]}.{B64("{\"sub\":\"alice\",\"role\":\"admin\",\"exp\":2000}")}.{parts[2]}";
        Call("alice with a forged role", forged, "list-users");
    }
}
