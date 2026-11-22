// Toy TCP connection-table models: who ends up in TIME_WAIT, how a single client-to-server pair runs out of source ports,
// how CLOSE_WAIT piles up when the application forgets to close, and how a small accept queue drops a burst.
// Assumptions: one tick is one second (one tick in the accept-queue model). Linux typically offers 28,232 ephemeral ports
// (32768 to 60999) and holds a closed connection in TIME_WAIT for 60 seconds; both vary by OS and settings.
// A connection is identified by (source IP, source port, destination IP, destination port); with one source IP talking to one
// destination address and port, only the source port can vary.

// Part 1: the states each side passes through, depending on who closes first.
function lifecycle(closer) {
  const active = ["ESTABLISHED", "FIN_WAIT_1", "FIN_WAIT_2", "TIME_WAIT", "CLOSED"];
  const passive = ["ESTABLISHED", "CLOSE_WAIT", "LAST_ACK", "CLOSED"];
  const clientOpen = ["SYN_SENT"], serverOpen = ["LISTEN", "SYN_RCVD"];
  return closer === "client"
    ? [clientOpen.concat(active), serverOpen.concat(passive)]
    : [clientOpen.concat(passive), serverOpen.concat(active)];
}
for (const closer of ["client", "server"]) {
  const [c, s] = lifecycle(closer);
  console.log(`${closer} closes first: client ${c.join(" > ")} | server ${s.join(" > ")}`);
}

// Part 2: one client IP making short connections to one server address and port.
const RANGE = 28232, SECONDS = 120;
function ports(rate, twSeconds, closer, ips) {
  const cap = RANGE * ips;
  const expiring = new Array(SECONDS + twSeconds + 1).fill(0);
  let held = 0, ok = 0, failed = 0, peak = 0;
  for (let t = 0; t < SECONDS; t++) {
    held -= expiring[t];
    const got = closer === "client" ? Math.min(rate, cap - held) : rate; // only the closing side blocks its own ports
    held += got; ok += got; failed += rate - got;
    expiring[t + twSeconds] += got;
    peak = Math.max(peak, held);
  }
  return `connections ok=${ok} failed (cannot assign address)=${failed} peak TIME_WAIT on the closing side=${peak}`;
}
console.log(`sustainable rate for one source IP: ${Math.floor(RANGE / 60)} new connections per second at 60 s TIME_WAIT`);
console.log("400/s, client closes:           " + ports(400, 60, "client", 1));
console.log("600/s, client closes:           " + ports(600, 60, "client", 1));
console.log("600/s, server closes:           " + ports(600, 60, "server", 1));
console.log("600/s, client, reuse after 1 s: " + ports(600, 1, "client", 1));
console.log("600/s, client, 2 source IPs:    " + ports(600, 60, "client", 2));
console.log("20/s, client closes (pooled):   " + ports(20, 60, "client", 1));

// Part 3: a server that closes only on the success path. Each leaked connection stays in CLOSE_WAIT and holds a file descriptor.
function leak(perTick, perMille, limit) {
  const base = 24; // descriptors used by the listening socket, logs and so on
  for (let t = 1; t <= 5000; t++) {
    const leaked = Math.floor((perTick * t * perMille) / 1000);
    if (leaked + base >= limit) return `${perMille} per 1000 leak: descriptor limit ${limit} reached at tick ${t} with ${leaked} connections stuck in CLOSE_WAIT`;
  }
  return `${perMille} per 1000 leak: limit not reached within 5000 ticks`;
}
console.log(leak(100, 0, 1024));
console.log(leak(100, 5, 1024));
console.log(leak(100, 20, 1024));

// Part 4: accept queue. A burst of 30 connections arrives every third tick (10 per tick on average); the app accepts `rate` per tick.
function accept(queueSize, rate) {
  let queue = 0, dropped = 0, accepted = 0;
  for (let t = 0; t <= 20; t++) {
    const arrivals = t % 3 === 0 ? 30 : 0;
    const room = Math.min(arrivals, queueSize - queue);
    queue += room; dropped += arrivals - room;
    const taken = Math.min(rate, queue);
    queue -= taken; accepted += taken;
  }
  return `queue ${queueSize}, app accepts ${rate}/tick: accepted=${accepted} dropped=${dropped}`;
}
console.log(accept(8, 10));
console.log(accept(32, 10));
console.log(accept(32, 5));
