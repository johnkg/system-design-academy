# A toy connection pool, simulated in whole seconds and milliseconds.
# A burst of B requests hits each of A app instances every `gap` seconds. Each instance keeps up to P connections.
# A new connection costs (1 TCP + tls) round trips before the request can be sent; a reused one costs nothing extra.
# The client closes a connection that has been idle for `client_idle` seconds (0 means no reuse at all).
# The load balancer and server silently drop one idle for `remote_idle` seconds; the client only finds out on its next send,
# which costs a wasted round trip (a reset) before it retries on a fresh connection: the "stale connection" error.
# The server accepts at most M connections in total; extra attempts are refused.
# Assumptions: RTT 40 ms, service time 20 ms, TLS 1.3 = 1 extra round trip, TLS 1.2 = 2. Real timeouts vary by product.

RTT, SERVICE, BURSTS = 40, 20, 6


def run(P, A, B, gap, client_idle, remote_idle, tls, M):
    pools = [[] for _ in range(A)]  # last-used second of each connection
    served = refused = setups = stale = lat_sum = lat_max = peak = 0
    slots = min(P, B)
    for k in range(BURSTS):
        t = k * gap
        for i in range(A):
            pools[i] = [last for last in pools[i] if t - last < client_idle]  # client closes idle ones cleanly
        open_conns = 0
        for pool in pools:
            for last in pool:
                if t - last < remote_idle:
                    open_conns += 1
        for i in range(A):
            pool = pools[i]
            for s in range(slots):
                n = -(-(B - s) // slots)  # requests that queue on this connection (ceiling)
                cost = 0
                if s < len(pool) and t - pool[s] < remote_idle:
                    pass  # live reuse
                else:
                    if s < len(pool):
                        stale += 1
                        cost += RTT  # wasted send, then reset
                    if open_conns >= M:
                        refused += n
                        continue
                    open_conns += 1
                    setups += 1
                    cost += (1 + tls) * RTT
                    if s >= len(pool):
                        pool.append(t)
                pool[s] = t
                for w in range(n):
                    lat = (cost if w == 0 else 0) + (w + 1) * (RTT + SERVICE)
                    lat_sum += lat
                    lat_max = max(lat_max, lat)
                    served += 1
        peak = max(peak, open_conns)
    avg = 0 if served == 0 else lat_sum // served
    return f"served={served} refused={refused} new connections={setups} stale errors={stale} avg latency={avg} ms max latency={lat_max} ms peak server connections={peak}"


print(f"new connection before first byte: TLS 1.3 {(1 + 1) * RTT} ms, TLS 1.2 {(1 + 2) * RTT} ms, reused 0 ms")
print("no reuse, TLS 1.3:           " + run(8, 4, 8, 30, 0, 60, 1, 100))
print("no reuse, TLS 1.2:           " + run(8, 4, 8, 30, 0, 60, 2, 100))
print("pooled, busy (gap 30 s):     " + run(8, 4, 8, 30, 50, 60, 1, 100))
print("pooled, quiet, idle 90 > 60: " + run(8, 4, 8, 70, 90, 60, 1, 100))
print("pooled, quiet, idle 50 < 60: " + run(8, 4, 8, 70, 50, 60, 1, 100))
print("40 instances, pool 8:        " + run(8, 40, 8, 30, 50, 60, 1, 100))
print("40 instances, pool 2:        " + run(2, 40, 8, 30, 50, 60, 1, 100))
