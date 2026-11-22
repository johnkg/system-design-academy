// Credential stuffing in a toy model: an attacker replays 20,000 email and password pairs leaked from another site against
// this site's login, from many addresses, once per pair. 2,000 of the pairs are for real accounts here, and some users reuse
// the leaked password. Then we turn on defences one at a time and see which ones matter.
// What to look for: per-IP and per-account limits barely touch the attack (it is spread out, one try per account),
// a password breach check and multi-factor authentication do, SMS, TOTP and tap-to-approve push each fail in their own way,
// and account recovery can undo all of it.
// Seeded integer generator, fixed events, integers only: the output never changes. Every rate here is an assumption of the toy.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Users = 2000, Attempts = 20000;
    const long Seed = 12345;
    static long state = Seed;
    static long Next() { state = state * 48271 % 2147483647; return state; } // MINSTD: the same sequence in every language

    // Each user's random facts, drawn up front so changing a setting never changes who is who.
    record Person(int Reuse, int Enrol, int Fooled, int SimSwap, int Mail, int Known, int[] Tap);
    static readonly Person[] World;
    static readonly long[] IpRaw;

    static Program()
    {
        state = Seed;
        World = new Person[Users];
        for (int u = 0; u < Users; u++)
        {
            var d = Enumerable.Range(0, 11).Select(_ => (int)(Next() % 100)).ToArray();
            World[u] = new Person(d[0], d[1], d[2], d[3], d[4], d[5], d[6..11]);
        }
        IpRaw = Enumerable.Range(0, Attempts).Select(_ => Next()).ToArray();
    }

    record Config(int Ips = 5000, int IpLimit = 0, int AcctLimit = 0, int BreachCover = 0, string Mfa = "none", int EnrolPct = 50, bool Relay = false, string Recovery = "email");
    const int ReusePct = 10;

    // Assumptions: 20% of owners are fooled by a live phishing page, 2% have a phone number that can be taken over (SIM swap),
    // a tired owner approves a tap prompt 10% of the time and gets 5 prompts, 3% of owners' email accounts also fall to the leak.
    static void Show(string label, Config c)
    {
        var ipFails = new int[c.Ips];
        var acctFails = new int[Users];
        int blockedIp = 0, blockedAcct = 0, screened = 0, hits = 0;
        var hit = new List<int>();
        for (int i = 0; i < Attempts; i++)
        {
            int ip = (int)(IpRaw[i] % c.Ips);
            if (c.IpLimit > 0 && ipFails[ip] >= c.IpLimit) { blockedIp++; continue; }
            int u = i % 10 == 0 ? i / 10 : -1; // one in ten pairs is for an account that exists here
            if (u < 0) { ipFails[ip]++; continue; }
            if (c.AcctLimit > 0 && acctFails[u] >= c.AcctLimit) { blockedAcct++; continue; }
            var w = World[u];
            if (w.Reuse < ReusePct)
            {
                if (c.BreachCover > 0 && w.Known < c.BreachCover) { screened++; continue; } // known-breached password: reset required, no login
                hits++; hit.Add(u);
            }
            else { ipFails[ip]++; acctFails[u]++; }
        }
        bool Enrolled(Person w) => c.Mfa != "none" && w.Enrol < c.EnrolPct;
        bool ByFatigue(Person w) => w.Tap.Any(d => d < 10);
        bool MfaBeaten(Person w)
        {
            bool relayed = c.Relay && w.Fooled < 20;
            if (c.Mfa == "sms") return relayed || w.SimSwap < 2;
            if (c.Mfa == "totp" || c.Mfa == "pushnm") return relayed;
            if (c.Mfa == "push") return relayed || ByFatigue(w);
            return false; // passkey: bound to the real site, so a relay or a prompt gets nothing
        }
        var taken = new HashSet<int>();
        int stopped = 0;
        foreach (int u in hit)
        {
            var w = World[u];
            if (!Enrolled(w) || MfaBeaten(w)) taken.Add(u); else stopped++;
        }
        int viaPassword = taken.Count;
        for (int u = 0; u < Users; u++)
        {
            var w = World[u];
            if (taken.Contains(u) || w.Mail >= 3) continue; // the attacker also holds this owner's email password
            if (c.Recovery == "email" || !Enrolled(w)) taken.Add(u); // email-only recovery skips the second factor
        }
        Console.WriteLine($"{label}: password hits {hits} (blocked by IP limit {blockedIp}, by account limit {blockedAcct}, by breach check {screened}), stopped by MFA {stopped}, taken over {viaPassword} + {taken.Count - viaPassword} by recovery = {taken.Count}");
    }

    public static void Main()
    {
        Console.WriteLine($"{Users} accounts, {Attempts} leaked pairs, 10% of users reuse a leaked password");
        Show("no defences, 5000 IPs", new Config());
        Show("no defences, 20 IPs", new Config(Ips: 20));
        Show("per-IP limit 20, 20 IPs", new Config(Ips: 20, IpLimit: 20));
        Show("per-IP limit 20, 5000 IPs", new Config(IpLimit: 20));
        Show("per-account limit 5, 5000 IPs", new Config(AcctLimit: 5));
        Show("breach check 70%, 5000 IPs", new Config(BreachCover: 70));
        foreach (var mfa in new[] { "sms", "totp", "push", "pushnm", "passkey" }) Show($"{mfa}, 50% enrolled", new Config(Mfa: mfa));
        foreach (var mfa in new[] { "sms", "totp", "push", "pushnm", "passkey" }) Show($"{mfa}, 50% enrolled, phishing relay", new Config(Mfa: mfa, Relay: true));
        Show("passkey, 100% enrolled, email recovery", new Config(Mfa: "passkey", EnrolPct: 100));
        Show("passkey, 100% enrolled, recovery needs the factor", new Config(Mfa: "passkey", EnrolPct: 100, Recovery: "email+mfa"));
        Show("everything: 20 IPs limit 20, breach 70, totp 100%, strict recovery", new Config(Ips: 20, IpLimit: 20, BreachCover: 70, Mfa: "totp", EnrolPct: 100, Recovery: "email+mfa"));
    }
}
