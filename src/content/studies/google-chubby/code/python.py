# A miniature of Chubby, Google's lock service (OSDI 2006), in Python (a teaching model, not Google's code):
# clients hold sessions kept alive by KeepAlive calls and lease timeouts, a lock is released only when its holder's session
# expires, a lock holder can hand a sequencer to the servers it talks to so that a delayed request from an old holder is
# refused, and a client rides out a master fail-over by keeping its session during a grace period. Everything is deterministic.

LEASE = 12  # seconds a KeepAlive extends a session lease (the paper's default)
cell = {"holder": None, "generation": 0, "sessions": {}}


def keep_alive(client, now):
    cell["sessions"][client] = now + LEASE


def expire_sessions(now):
    for client, end in list(cell["sessions"].items()):
        if end > now:
            continue
        del cell["sessions"][client]
        print(f"t={now}: {client}'s session lease ran out (it ended at {end})")
        if cell["holder"] == client:
            cell["holder"] = None
            print(f"t={now}: the lock held by {client} is released")


def acquire(client, now):
    if cell["holder"] is not None:
        return None
    cell["holder"] = client
    cell["generation"] += 1
    print(f"t={now}: {client} acquires the lock, sequencer generation {cell['generation']}")
    return {"generation": cell["generation"]}  # the sequencer a holder passes along with its requests


# Two file servers receive writes. One ignores sequencers; the other checks them against the newest generation it has seen.
naive = {"data": ""}
checking = {"data": "", "newest": 0}


def write(client, sequencer, value, now):
    naive["data"] = value
    if sequencer["generation"] < checking["newest"]:
        print(f"t={now}: {client}'s write with generation {sequencer['generation']} is refused by the checking server (newest seen: {checking['newest']})")
        return
    checking["newest"] = sequencer["generation"]
    checking["data"] = value
    print(f"t={now}: {client}'s write with generation {sequencer['generation']} accepted")


print("--- a stalled lock holder")
keep_alive("A", 0)
seq_a = acquire("A", 0)
write("A", seq_a, "A-data", 1)
keep_alive("A", 5)  # A's last KeepAlive; then it stalls
print("t=5: A stalls (a long pause) and stops sending KeepAlive calls")
for t in range(6, 17):
    expire_sessions(t)  # nothing happens: A's lease is still running, so the lock stays with A
expire_sessions(17)
keep_alive("B", 17)
seq_b = acquire("B", 17)
write("B", seq_b, "B-data", 17)
write("A", seq_a, "A-late-data", 30)
print(f"file server that ignores sequencers holds: {naive['data']}")
print(f"file server that checks sequencers holds: {checking['data']}")

print("--- a master fail-over and the grace period")


def failover(grace):
    lease_end, new_master_at = 40, 44  # the client's lease ends at 40; a new master is elected 6 seconds after the old one failed
    deadline = lease_end + grace
    survived = new_master_at <= deadline
    outcome = "kept, its locks survive" if survived else "lost, its locks are gone"
    print(f"grace period {grace}s: lease ends at {lease_end}, client in jeopardy, new master at {new_master_at}, deadline {deadline} -> session {outcome}")


failover(45)
failover(3)
