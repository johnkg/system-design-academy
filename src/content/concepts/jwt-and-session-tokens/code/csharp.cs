// Minimal JWT (HS256) sign and verify using only the standard library.
// Verification pins the algorithm, checks the signature in constant time, then checks exp, iss and aud.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

static string B64(byte[] data) => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
static string B64s(string s) => B64(Encoding.UTF8.GetBytes(s));
static byte[] Unb64(string s)
{
    s = s.Replace('-', '+').Replace('_', '/');
    s += new string('=', (4 - s.Length % 4) % 4);
    return Convert.FromBase64String(s);
}
static byte[] Mac(string secret, string data) => HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(data));

static string Sign(string iss, string sub, string aud, int exp, string secret, string header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}")
{
    string payload = $"{{\"iss\":\"{iss}\",\"sub\":\"{sub}\",\"aud\":\"{aud}\",\"exp\":{exp}}}";
    string input = B64s(header) + "." + B64s(payload);
    return input + "." + B64(Mac(secret, input));
}

static string Verify(string token, string secret, int now, string expIss, string expAud)
{
    string[] parts = token.Split('.');
    if (parts.Length != 3) return "reject: malformed";
    JsonElement header, claims;
    try { header = JsonDocument.Parse(Unb64(parts[0])).RootElement; } catch { return "reject: malformed"; }
    if (!header.TryGetProperty("alg", out var alg) || alg.GetString() != "HS256") return "reject: alg is not HS256"; // pin it (blocks none)
    byte[] want = Mac(secret, parts[0] + "." + parts[1]);
    byte[] got = Unb64(parts[2]);
    if (got.Length != want.Length || !CryptographicOperations.FixedTimeEquals(got, want)) return "reject: bad signature";
    try { claims = JsonDocument.Parse(Unb64(parts[1])).RootElement; } catch { return "reject: malformed"; }
    if (claims.GetProperty("exp").GetInt32() <= now) return "reject: expired";
    if (claims.GetProperty("iss").GetString() != expIss) return "reject: wrong issuer";
    if (claims.GetProperty("aud").GetString() != expAud) return "reject: wrong audience";
    return "ok";
}

const string Secret = "demo-secret-at-least-32-bytes-long!";
const int Now = 1000;
const int TokenTtlS = 300; // access tokens live 5 minutes
string token = Sign("auth.shop", "alice", "orders-api", Now + TokenTtlS, Secret);
Console.WriteLine("token: " + token.Substring(0, 36) + "...");

string[] tp = token.Split('.');
string tamperedPayload = B64s("{\"iss\":\"auth.shop\",\"sub\":\"admin\",\"aud\":\"orders-api\",\"exp\":1300}");
var cases = new List<(string Name, string Tok, string Want)>
{
    ("valid token", token, "ok"),
    ("alg=none, empty signature", B64s("{\"alg\":\"none\",\"typ\":\"JWT\"}") + "." + tp[1] + ".", "reject: alg is not HS256"),
    ("tampered payload (sub=admin)", tp[0] + "." + tamperedPayload + "." + tp[2], "reject: bad signature"),
    ("signed with another key", Sign("auth.shop", "alice", "orders-api", Now + TokenTtlS, "some-other-secret-of-32-bytes-xxxx"), "reject: bad signature"),
    ("expired", Sign("auth.shop", "alice", "orders-api", Now - 1, Secret), "reject: expired"),
    ("wrong audience", Sign("auth.shop", "alice", "billing-api", Now + TokenTtlS, Secret), "reject: wrong audience"),
    ("wrong issuer", Sign("evil.example", "alice", "orders-api", Now + TokenTtlS, Secret), "reject: wrong issuer"),
    ("two parts only", tp[0] + "." + tp[1], "reject: malformed"),
};

int failed = 0;
foreach (var (name, tok, want) in cases)
{
    string got = Verify(tok, Secret, Now, "auth.shop", "orders-api");
    bool okay = got == want;
    if (!okay) failed++;
    Console.WriteLine($"{name,-30} -> {got}{(okay ? "" : " (EXPECTED " + want + ")")}");
}
if (failed > 0) { Console.WriteLine($"{failed} case(s) wrong"); return 1; }
Console.WriteLine($"all {cases.Count} cases behave as expected");
return 0;
