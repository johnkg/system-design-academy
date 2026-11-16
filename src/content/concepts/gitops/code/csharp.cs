// GitOps reconciler: Git holds the desired state, a controller in the cluster pulls it and makes the live state match.
// A 15-minute window of one app, second by second. Everything is integers and fixed events, so the output never changes.
using System;
using System.Collections.Generic;

public static class Program
{
    const int End = 900;        // seconds simulated
    const int Poll = 180;       // how often the controller looks at Git (3 minutes is a common default)
    const int React = 5;        // a webhook, or a change the controller sees in the cluster, is acted on this many seconds later
    const int AlertAfter = 60;  // a broken version is noticed, and reverted in Git, this long after it goes live
    const int HandEditAt = 200; // someone runs "kubectl scale --replicas=10" by hand

    record Commit(int At, string? Image, bool RemoveJob, bool Revert = false);
    // Commits to Git: deploy v2, deploy v3 (which is broken), delete the old cleanup job.
    static readonly Commit[] Commits = { new(20, "v2", false), new(430, "v3", false), new(640, null, true) };

    class State { public string Image = "v1"; public int Replicas = 3; public bool Job = true; public State Copy() => (State)MemberwiseClone(); }

    static void Run(string name, bool webhook, bool selfHeal, bool prune)
    {
        var git = new State();
        var live = git.Copy();
        var applied = git.Copy();   // what the controller last applied from Git
        var todo = new List<(int At, string Why)>();
        var log = new List<string>();
        int handAt = -1, handLasted = -1, v2LiveAt = -1, v3LiveAt = -1, badFor = -1, revertAt = -1, outOfSync = 0;

        void Sync(int t, string why)
        {
            bool gitChanged = git.Image != applied.Image || git.Job != applied.Job;
            bool drifted = live.Replicas != git.Replicas;
            if (!gitChanged && !(drifted && why == "self-heal")) return;
            // A sync applies every manifest in Git, so it also undoes hand edits. Deleting what Git no longer lists needs prune.
            if (drifted && handLasted < 0) { handLasted = t - handAt; log.Add($"{t}s {why}: replicas 10 -> 3 (the hand edit is gone)"); }
            if (live.Image != git.Image) log.Add($"{t}s {why}: image {live.Image} -> {git.Image}");
            live.Image = git.Image; live.Replicas = git.Replicas;
            if (live.Job && !git.Job && prune) { live.Job = false; log.Add($"{t}s {why}: cleanup job deleted"); }
            applied = git.Copy();
            if (live.Image == "v2" && v2LiveAt < 0) v2LiveAt = t;
            if (live.Image == "v3" && v3LiveAt < 0) v3LiveAt = t;
            if (v3LiveAt >= 0 && badFor < 0 && live.Image != "v3") badFor = t - v3LiveAt;
        }

        void Apply(int t, Commit c)
        {
            if (c.Image != null) git.Image = c.Image;
            if (c.RemoveJob) git.Job = false;
            string what = c.Revert ? "revert to image v2" : c.Image != null ? $"image {c.Image}" : "delete the cleanup job";
            log.Add($"{t}s commit: {what}");
            if (webhook) todo.Add((t + React, "webhook"));
        }

        for (int t = 1; t <= End; t++)
        {
            foreach (var c in Commits) if (c.At == t) Apply(t, c);
            if (v3LiveAt >= 0 && revertAt < 0 && t == v3LiveAt + AlertAfter) { revertAt = t; Apply(t, new Commit(t, "v2", false, true)); }
            if (t == HandEditAt)
            {
                live.Replicas = 10; handAt = t; log.Add($"{t}s hand edit: replicas 3 -> 10");
                if (selfHeal) todo.Add((t + React, "self-heal")); // the controller watches the cluster and sees the change
            }
            foreach (var (at, why) in todo.ToArray()) if (at == t) Sync(t, why);
            if (t % Poll == 0) Sync(t, "poll");
            if (live.Image != git.Image || live.Replicas != git.Replicas || live.Job != git.Job) outOfSync++;
        }

        Console.WriteLine($"-- {name}");
        foreach (var line in log) Console.WriteLine($"  {line}");
        Console.WriteLine($"  v2 live {v2LiveAt - Commits[0].At}s after its commit; broken v3 served for {badFor}s");
        string hand = handLasted < 0 ? "never undone" : $"lasted {handLasted}s";
        string job = live.Job ? "still running, an orphan" : "deleted";
        Console.WriteLine($"  hand edit {hand}; cleanup job {job}; out of sync {outOfSync}s of {End}");
        if (outOfSync > End || badFor <= 0) throw new Exception("impossible result");
    }

    public static void Main()
    {
        Run("poll every 3 min, no self-heal, no prune", webhook: false, selfHeal: false, prune: false);
        Run("poll every 3 min, self-heal, prune", webhook: false, selfHeal: true, prune: true);
        Run("webhook on push, self-heal, prune", webhook: true, selfHeal: true, prune: true);
    }
}
