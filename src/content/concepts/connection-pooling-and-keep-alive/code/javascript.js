// A toy connection pool, simulated in whole seconds and milliseconds.
// A burst of B requests hits each of A app instances every `gap` seconds. Each instance keeps up to P connections.
// A new connection costs (1 TCP + tls) round trips before the request can be sent; a reused one costs nothing extra.
// The client closes a connection that has been idle for `clientIdle` seconds (0 means no reuse at all).
// The load balancer and server silently drop one idle for `remoteIdle` seconds; the client only finds out on its next send,
// which costs a wasted round trip (a reset) before it retries on a fresh connection: the "stale connection" error.
// The server accepts at most M connections in total; extra attempts are refused.
// Assumptions: RTT 40 ms, service time 20 ms, TLS 1.3 = 1 extra round trip, TLS 1.2 = 2. Real timeouts vary by product.

const RTT = 40, SERVICE = 20, BURSTS = 6;

function run(P, A, B, gap, clientIdle, remoteIdle, tls, M) {
  const pools = Array.from({ length: A }, () => []); // lastUsed second of each connection
  let served = 0, refused = 0, setups = 0, stale = 0, latSum = 0, latMax = 0, peak = 0;
  const slots = Math.min(P, B);
  for (let k = 0; k < BURSTS; k++) {
    const t = k * gap;
    for (let i = 0; i < A; i++) pools[i] = pools[i].filter((last) => t - last < clientIdle); // client closes idle ones cleanly
    let open = 0;
    for (const pool of pools) for (const last of pool) if (t - last < remoteIdle) open++;
    for (let i = 0; i < A; i++) {
      const pool = pools[i];
      for (let s = 0; s < slots; s++) {
        const n = Math.ceil((B - s) / slots); // requests that queue on this connection
        let cost = 0;
        if (s < pool.length && t - pool[s] < remoteIdle) { /* live reuse */ }
        else {
          if (s < pool.length) { stale++; cost += RTT; } // wasted send, then reset
          if (open >= M) { refused += n; continue; }
          open++; setups++; cost += (1 + tls) * RTT;
          pool[s] = t;
        }
        pool[s] = t;
        for (let w = 0; w < n; w++) {
          const lat = cost + (w + 1) * (RTT + SERVICE); // queued requests also wait for the setup
          latSum += lat; latMax = Math.max(latMax, lat); served++;
        }
      }
    }
    peak = Math.max(peak, open);
  }
  const avg = served === 0 ? 0 : Math.floor(latSum / served);
  return `served=${served} refused=${refused} new connections=${setups} stale errors=${stale} avg latency=${avg} ms max latency=${latMax} ms peak server connections=${peak}`;
}

console.log(`new connection before first byte: TLS 1.3 ${(1 + 1) * RTT} ms, TLS 1.2 ${(1 + 2) * RTT} ms, reused 0 ms`);
console.log("no reuse, TLS 1.3:           " + run(8, 4, 8, 30, 0, 60, 1, 100));
console.log("no reuse, TLS 1.2:           " + run(8, 4, 8, 30, 0, 60, 2, 100));
console.log("pooled, busy (gap 30 s):     " + run(8, 4, 8, 30, 50, 60, 1, 100));
console.log("pooled, quiet, idle 90 > 60: " + run(8, 4, 8, 70, 90, 60, 1, 100));
console.log("pooled, quiet, idle 50 < 60: " + run(8, 4, 8, 70, 50, 60, 1, 100));
console.log("40 instances, pool 8:        " + run(8, 40, 8, 30, 50, 60, 1, 100));
console.log("40 instances, pool 2:        " + run(2, 40, 8, 30, 50, 60, 1, 100));
