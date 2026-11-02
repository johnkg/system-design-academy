// A miniature of Chubby, Google's lock service (OSDI 2006), in C# (a teaching model, not Google's code):
// clients hold sessions kept alive by KeepAlive calls and lease timeouts, a lock is released only when its holder's session
// expires, a lock holder can hand a sequencer to the servers it talks to so that a delayed request from an old holder is
// refused, and a client rides out a master fail-over by keeping its session during a grace period. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

const int Lease = 12; // seconds a KeepAlive extends a session lease (the paper's default)
string? holder = null;
int generation = 0;
var sessions = new Dictionary<string, int>();

void KeepAlive(string client, int now) => sessions[client] = now + Lease;

void ExpireSessions(int now)
{
    foreach (var (client, end) in sessions.ToList())
    {
        if (end > now) continue;
        sessions.Remove(client);
        Console.WriteLine($"t={now}: {client}'s session lease ran out (it ended at {end})");
        if (holder == client)
        {
            holder = null;
            Console.WriteLine($"t={now}: the lock held by {client} is released");
        }
    }
}

int? Acquire(string client, int now) // returns the sequencer generation a holder passes along with its requests
{
    if (holder != null) return null;
    holder = client;
    generation++;
    Console.WriteLine($"t={now}: {client} acquires the lock, sequencer generation {generation}");
    return generation;
}

// Two file servers receive writes. One ignores sequencers; the other checks them against the newest generation it has seen.
string naiveData = "", checkingData = "";
int newest = 0;

void Write(string client, int seq, string value, int now)
{
    naiveData = value;
    if (seq < newest)
    {
        Console.WriteLine($"t={now}: {client}'s write with generation {seq} is refused by the checking server (newest seen: {newest})");
        return;
    }
    newest = seq;
    checkingData = value;
    Console.WriteLine($"t={now}: {client}'s write with generation {seq} accepted");
}

Console.WriteLine("--- a stalled lock holder");
KeepAlive("A", 0);
int seqA = Acquire("A", 0)!.Value;
Write("A", seqA, "A-data", 1);
KeepAlive("A", 5); // A's last KeepAlive; then it stalls
Console.WriteLine("t=5: A stalls (a long pause) and stops sending KeepAlive calls");
for (int t = 6; t <= 16; t++) ExpireSessions(t); // nothing happens: A's lease is still running, so the lock stays with A
ExpireSessions(17);
KeepAlive("B", 17);
int seqB = Acquire("B", 17)!.Value;
Write("B", seqB, "B-data", 17);
Write("A", seqA, "A-late-data", 30);
Console.WriteLine($"file server that ignores sequencers holds: {naiveData}");
Console.WriteLine($"file server that checks sequencers holds: {checkingData}");

Console.WriteLine("--- a master fail-over and the grace period");
void Failover(int grace)
{
    int leaseEnd = 40, newMasterAt = 44; // the client's lease ends at 40; a new master is elected 6 seconds after the old one failed
    int deadline = leaseEnd + grace;
    bool survived = newMasterAt <= deadline;
    Console.WriteLine($"grace period {grace}s: lease ends at {leaseEnd}, client in jeopardy, new master at {newMasterAt}, deadline {deadline} -> session {(survived ? "kept, its locks survive" : "lost, its locks are gone")}");
}
Failover(45);
Failover(3);
