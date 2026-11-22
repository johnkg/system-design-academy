# Toy TCP connection-table models: who ends up in TIME_WAIT, how a single client-to-server pair runs out of source ports,
# how CLOSE_WAIT piles up when the application forgets to close, and how a small accept queue drops a burst.
# Assumptions: one tick is one second (one tick in the accept-queue model). Linux typically offers 28,232 ephemeral ports
# (32768 to 60999) and holds a closed connection in TIME_WAIT for 60 seconds; both vary by OS and settings.
# A connection is identified by (source IP, source port, destination IP, destination port); with one source IP talking to one
# destination address and port, only the source port can vary.


# Part 1: the states each side passes through, depending on who closes first.
def lifecycle(closer):
    active = ["ESTABLISHED", "FIN_WAIT_1", "FIN_WAIT_2", "TIME_WAIT", "CLOSED"]
    passive = ["ESTABLISHED", "CLOSE_WAIT", "LAST_ACK", "CLOSED"]
    client_open = ["SYN_SENT"]
    server_open = ["LISTEN", "SYN_RCVD"]
    if closer == "client":
        return client_open + active, server_open + passive
    return client_open + passive, server_open + active


for closer in ["client", "server"]:
    c, s = lifecycle(closer)
    print(f"{closer} closes first: client {' > '.join(c)} | server {' > '.join(s)}")

# Part 2: one client IP making short connections to one server address and port.
RANGE, SECONDS = 28232, 120


def ports(rate, tw_seconds, closer, ips):
    cap = RANGE * ips
    expiring = [0] * (SECONDS + tw_seconds + 1)
    held = ok = failed = peak = 0
    for t in range(SECONDS):
        held -= expiring[t]
        got = min(rate, cap - held) if closer == "client" else rate  # only the closing side blocks its own ports
        held += got
        ok += got
        failed += rate - got
        expiring[t + tw_seconds] += got
        peak = max(peak, held)
    return f"connections ok={ok} failed (cannot assign address)={failed} peak TIME_WAIT on the closing side={peak}"


print(f"sustainable rate for one source IP: {RANGE // 60} new connections per second at 60 s TIME_WAIT")
print("400/s, client closes:           " + ports(400, 60, "client", 1))
print("600/s, client closes:           " + ports(600, 60, "client", 1))
print("600/s, server closes:           " + ports(600, 60, "server", 1))
print("600/s, client, reuse after 1 s: " + ports(600, 1, "client", 1))
print("600/s, client, 2 source IPs:    " + ports(600, 60, "client", 2))
print("20/s, client closes (pooled):   " + ports(20, 60, "client", 1))


# Part 3: a server that closes only on the success path. Each leaked connection stays in CLOSE_WAIT and holds a file descriptor.
def leak(per_tick, per_mille, limit):
    base = 24  # descriptors used by the listening socket, logs and so on
    for t in range(1, 5001):
        leaked = (per_tick * t * per_mille) // 1000
        if leaked + base >= limit:
            return f"{per_mille} per 1000 leak: descriptor limit {limit} reached at tick {t} with {leaked} connections stuck in CLOSE_WAIT"
    return f"{per_mille} per 1000 leak: limit not reached within 5000 ticks"


print(leak(100, 0, 1024))
print(leak(100, 5, 1024))
print(leak(100, 20, 1024))


# Part 4: accept queue. A burst of 30 connections arrives every third tick (10 per tick on average); the app accepts `rate` per tick.
def accept(queue_size, rate):
    queue = dropped = accepted = 0
    for t in range(21):
        arrivals = 30 if t % 3 == 0 else 0
        room = min(arrivals, queue_size - queue)
        queue += room
        dropped += arrivals - room
        taken = min(rate, queue)
        queue -= taken
        accepted += taken
    return f"queue {queue_size}, app accepts {rate}/tick: accepted={accepted} dropped={dropped}"


print(accept(8, 10))
print(accept(32, 10))
print(accept(32, 5))
