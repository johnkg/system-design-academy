// A mini OAuth 2.0 authorization server (authorization code + PKCE S256) and the checks that matter.
// Time is passed in by hand so the demo is deterministic.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

public record Reply(bool Ok, string Value);
public class CodeRecord { public string Client = "", Redirect = "", Challenge = "", Token = ""; public int Exp; public bool Used; }

public class AuthServer
{
    const int CodeTtl = 60; // seconds; RFC 6749 recommends a maximum of 10 minutes, shorter is better
    readonly Dictionary<string, string> registered; // client_id -> the one registered redirect_uri (exact match)
    readonly Dictionary<string, CodeRecord> codes = new();
    public readonly Dictionary<string, bool> Tokens = new(); // access token -> still valid?
    int n;

    public AuthServer(Dictionary<string, string> registered) { this.registered = registered; }

    public static string B64Url(byte[] raw) => Convert.ToBase64String(raw).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static string S256(string verifier) => B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    public Reply Authorize(string clientId, string redirectUri, string challenge, string method, int now)
    {
        if (!registered.TryGetValue(clientId, out var r) || r != redirectUri) return new(false, "invalid_request: redirect_uri is not registered"); // never redirect to it
        if (method != "S256" || challenge == "") return new(false, "invalid_request: code_challenge with S256 is required");
        n++;
        var code = $"code-{n}";
        codes[code] = new CodeRecord { Client = clientId, Redirect = redirectUri, Challenge = challenge, Exp = now + CodeTtl };
        return new(true, code);
    }

    public Reply Token(string code, string clientId, string redirectUri, string verifier, int now)
    {
        if (!codes.TryGetValue(code, out var rec)) return new(false, "invalid_grant: unknown code");
        if (rec.Used)
        {
            Tokens[rec.Token] = false; // replay: revoke what the first redemption produced
            return new(false, "invalid_grant: code already used, its token is revoked");
        }
        if (now > rec.Exp) return new(false, "invalid_grant: code expired");
        if (rec.Client != clientId || rec.Redirect != redirectUri) return new(false, "invalid_grant: client or redirect_uri differs from the authorization request");
        if (verifier == "" || S256(verifier) != rec.Challenge) return new(false, "invalid_grant: code_verifier does not match code_challenge");
        rec.Used = true;
        rec.Token = $"at-{code.Substring(5)}";
        Tokens[rec.Token] = true;
        return new(true, rec.Token);
    }
}

public static class Program
{
    static int failures = 0;
    static void Check(string label, Reply got, bool wantOk)
    {
        Console.WriteLine($"{label}: {(got.Ok ? "ok" : "refused")} {got.Value}");
        if (got.Ok != wantOk) failures++;
    }
    static bool CallbackStateOk(string? expected, string received) => expected != null && expected == received; // the client's own check against login CSRF
    static string Lower(bool b) => b ? "true" : "false";

    public static int Main()
    {
        const string Verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // RFC 7636 appendix B
        var challenge = AuthServer.S256(Verifier);
        const string Redirect = "printshop://cb";
        Console.WriteLine("challenge: " + challenge);
        if (challenge != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM") failures++;

        var server = new AuthServer(new() { ["printshop"] = Redirect });
        var code1 = server.Authorize("printshop", Redirect, challenge, "S256", 0).Value;
        Check("legit redeem", server.Token(code1, "printshop", Redirect, Verifier, 5), true);
        Check("replay of the same code", server.Token(code1, "printshop", Redirect, Verifier, 6), false);
        Console.WriteLine("first token still valid: " + Lower(server.Tokens["at-1"]));

        var code2 = server.Authorize("printshop", Redirect, challenge, "S256", 10).Value;
        Check("stolen code, no verifier", server.Token(code2, "printshop", Redirect, "", 11), false);
        Check("stolen code, guessed verifier", server.Token(code2, "printshop", Redirect, new string('x', 43), 11), false);
        Check("redeem with other redirect_uri", server.Token(code2, "printshop", "https://evil.test/cb", Verifier, 12), false);
        Check("legit client still succeeds", server.Token(code2, "printshop", Redirect, Verifier, 13), true);

        Check("authorize with forged redirect_uri", server.Authorize("printshop", "printshop://cb/../evil", challenge, "S256", 20), false);
        Check("authorize without PKCE", server.Authorize("printshop", Redirect, "", "S256", 20), false);
        var code3 = server.Authorize("printshop", Redirect, challenge, "S256", 30).Value;
        Check("redeem after 61 s", server.Token(code3, "printshop", Redirect, Verifier, 91), false);

        Console.WriteLine("state matches: " + Lower(CallbackStateOk("k3j9", "k3j9")));
        Console.WriteLine("state forged: " + Lower(CallbackStateOk("k3j9", "attacker")));
        Console.WriteLine("state missing from session: " + Lower(CallbackStateOk(null, "attacker")));
        bool bad = failures > 0 || server.Tokens["at-1"] || !CallbackStateOk("k3j9", "k3j9") || CallbackStateOk("k3j9", "attacker");
        return bad ? 1 : 0;
    }
}
