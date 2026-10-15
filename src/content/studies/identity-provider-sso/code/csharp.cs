// A tiny identity provider in C#:
// a login session, signed tokens, key rotation, MFA step-up, back-channel logout and one set of keys per tenant.
// The "signature" is FNV-1a over a shared secret so the sample is deterministic; a real IdP signs with an RSA or EC private key.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Hash
{
    public static uint Fnv(string s) { uint h = 2166136261; foreach (char c in s) { h ^= c; h *= 16777619; } return h; }
    public static string Hex(uint n) => n.ToString("x8");
}
public class Key { public string Kid = ""; public uint Secret; public int? Retired; }
public class Session { public string Sub = ""; public int Acr, AuthTime; public List<string> Rps = new(); }

public class Idp
{
    public const int Ttl = 600; // token lifetime in seconds
    readonly string tenant;
    readonly Dictionary<string, Session> sessions = new();
    readonly List<Key> keys = new();
    int next = 1;
    public Idp(string tenant) { this.tenant = tenant; keys.Add(new Key { Kid = "k1", Secret = Hash.Fnv(tenant + "/k1") }); }
    Key Active => keys[^1];
    public void Rotate(int now)
    {
        Active.Retired = now; string kid = "k" + (keys.Count + 1);
        keys.Add(new Key { Kid = kid, Secret = Hash.Fnv(tenant + "/" + kid) });
    }
    // The published key set: the active key, plus a retired key until every token it signed has expired.
    public Dictionary<string, uint> Jwks(int now) =>
        keys.Where(k => k.Retired == null || now < k.Retired + Ttl).ToDictionary(k => k.Kid, k => k.Secret);
    public string Login(string sub, int now, bool mfa)
    {
        string sid = $"{tenant}-s{next++}";
        sessions[sid] = new Session { Sub = sub, Acr = mfa ? 2 : 1, AuthTime = now };
        return sid;
    }
    public void StepUp(string sid, int now) { var s = sessions[sid]; s.Acr = 2; s.AuthTime = now; }
    public string? Issue(string sid, string aud, int now)
    {
        if (!sessions.TryGetValue(sid, out var s)) return null;
        if (!s.Rps.Contains(aud)) s.Rps.Add(aud); // remember which apps to notify at logout
        var k = Active;
        string body = string.Join("|", k.Kid, s.Sub, aud, sid, s.Acr, s.AuthTime, now + Ttl);
        return $"{body}|{Hash.Hex(Hash.Fnv(k.Secret + "|" + body))}";
    }
    public int Logout(string sid, Dictionary<string, Rp> rps)
    {
        var s = sessions[sid]; sessions.Remove(sid);
        s.Rps.ForEach(a => rps[a].Revoke(sid));
        return s.Rps.Count;
    }
}
public class Rp // a relying party: an application that trusts one IdP
{
    readonly string aud; readonly Idp idp; readonly HashSet<string> revoked = new();
    public Rp(string aud, Idp idp) { this.aud = aud; this.idp = idp; }
    public void Revoke(string sid) => revoked.Add(sid); // the back-channel logout endpoint
    public string Check(string token, int now, int minAcr = 1, int maxAge = 1000000)
    {
        var f = token.Split('|');
        if (!idp.Jwks(now).TryGetValue(f[0], out var secret)) return "unknown_kid"; // a real RP refetches its key set on an unknown kid
        if (Hash.Hex(Hash.Fnv(secret + "|" + string.Join("|", f.Take(7)))) != f[7]) return "bad_signature";
        if (f[2] != aud) return "wrong_audience";
        if (now >= int.Parse(f[6])) return "expired";
        if (revoked.Contains(f[3])) return "revoked";
        if (int.Parse(f[4]) < minAcr || now - int.Parse(f[5]) > maxAge) return "step_up_required";
        return "ok";
    }
}
public static class Program
{
    static int fails = 0;
    static void Expect(string label, string got, string want) { Console.WriteLine($"{label}: {got}"); fails += got == want ? 0 : 1; }
    public static int Main()
    {
        Idp acme = new("acme"), globex = new("globex");
        Rp mail = new("mail", acme), wiki = new("wiki", acme);
        var rps = new Dictionary<string, Rp> { ["mail"] = mail, ["wiki"] = wiki };
        string sid = acme.Login("alice", 0, false);
        Expect("mail at 100", mail.Check(acme.Issue(sid, "mail", 100)!, 100), "ok");
        Expect("admin page at 150 (needs mfa)", wiki.Check(acme.Issue(sid, "wiki", 150)!, 150, 2, 300), "step_up_required");
        acme.StepUp(sid, 160);
        string admin = acme.Issue(sid, "wiki", 160)!;
        Expect("admin page at 170 after mfa", wiki.Check(admin, 170, 2, 300), "ok");
        Expect("admin page at 500 (mfa too old)", wiki.Check(admin, 500, 2, 300), "step_up_required");

        string old = acme.Issue(sid, "mail", 900)!;
        acme.Rotate(1000);
        Expect("old token after rotation, 1100", mail.Check(old, 1100), "ok");
        string fresh = acme.Issue(sid, "mail", 1100)!;
        Console.WriteLine($"signing keys: {string.Join(",", acme.Jwks(1100).Keys)} at 1100, {string.Join(",", acme.Jwks(1600).Keys)} at 1600");
        Expect("old token at 1600", mail.Check(old, 1600), "unknown_kid");
        Expect("new token at 1200", mail.Check(fresh, 1200), "ok");

        var forged = fresh.Split('|'); forged[4] = "3";
        Expect("token with acr edited", mail.Check(string.Join("|", forged), 1200), "bad_signature");
        Expect("globex token at acme mail", mail.Check(globex.Issue(globex.Login("bob", 0, true), "mail", 1300)!, 1300), "bad_signature");

        string live = acme.Issue(sid, "wiki", 1250)!;
        Console.WriteLine($"logout notified {acme.Logout(sid, rps)} apps");
        Expect("mail token after logout", mail.Check(fresh, 1301), "revoked");
        Expect("wiki token after logout", wiki.Check(live, 1301), "revoked");
        Expect("new token after logout", acme.Issue(sid, "mail", 1302) ?? "null", "null");
        return fails == 0 ? 0 : 1;
    }
}
