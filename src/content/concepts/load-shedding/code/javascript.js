// Load shedding: the same 3x overload against three queue policies. Deterministic discrete-time simulation, integers only.
// One step is 100 ms. The server completes 10 requests per step (100 per second). Clients give up after 20 steps (2 s).
const STEPS = 200, SPIKE_STEPS = 100; // 20 s in total, the first 10 s overloaded
const CAPACITY = 10, TIMEOUT = 20, LIMIT = 50;
const SPIKE_ARRIVALS = 30, CALM_ARRIVALS = 6; // 300 per second, then 60 per second

function run(policy) {
  const queue = []; let head = 0; // each entry is the step the request arrived in
  let good = 0, wasted = 0, rejected = 0, dropped = 0, latSum = 0;
  for (let step = 0; step < STEPS; step++) {
    const arrivals = step < SPIKE_STEPS ? SPIKE_ARRIVALS : CALM_ARRIVALS;
    for (let i = 0; i < arrivals; i++) {
      const waiting = queue.length - head;
      if (policy === "bounded" && waiting >= LIMIT) {
        rejected++; // fail fast: an immediate 503, no queueing, no work
        continue;
      }
      if (policy === "lifo" && waiting >= LIMIT) {
        head++; // drop the oldest: its caller is the most likely to be gone
        dropped++;
      }
      queue.push(step);
    }
    for (let i = 0; i < CAPACITY; i++) {
      if (queue.length - head === 0) break;
      const arrived = policy === "lifo" ? queue.pop() : queue[head++];
      const latency = step - arrived + 1;
      if (latency <= TIMEOUT) {
        good++; // an answer the caller was still waiting for
        latSum += latency * 100;
      } else {
        wasted++; // the server was busy, but the caller had already left
      }
    }
  }
  return { good, wasted, rejected, dropped, left: queue.length - head, avgMs: good ? Math.floor(latSum / good) : 0 };
}

const results = { fifo: run("fifo"), bounded: run("bounded"), lifo: run("lifo") };
for (const [name, r] of Object.entries(results)) {
  console.log(`${name.padEnd(8)} good=${r.good} wasted=${r.wasted} rejected=${r.rejected} dropped=${r.dropped} left=${r.left} avg_latency_ms=${r.avgMs}`);
}

const { fifo, bounded, lifo } = results;
const check = (ok, msg) => { if (!ok) { console.error("assertion failed: " + msg); process.exit(1); } };
check(bounded.good > fifo.good, "fail-fast must beat an unbounded queue under 3x overload");
check(lifo.good > fifo.good && bounded.wasted === 0 && fifo.wasted > 0, "only the unbounded queue wastes work");
check(lifo.avgMs < bounded.avgMs, "newest-first answers faster than oldest-first");
check(fifo.left > 0 && bounded.left <= LIMIT, "the unbounded queue is still backed up");
for (const r of Object.values(results)) check(r.good + r.wasted <= CAPACITY * STEPS, "cannot serve more than capacity");
console.log("goodput ratio bounded/fifo:", Math.floor((bounded.good * 100) / fifo.good), "percent");
