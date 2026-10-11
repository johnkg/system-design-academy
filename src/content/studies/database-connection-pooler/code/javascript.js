// A transaction-mode connection pooler with a bounded wait queue, in JavaScript:
// many clients share a few server connections, the excess waits in a first-in first-out queue, and a request that waits too long fails.
// Time moves in whole milliseconds.

const WAIT_LIMIT = 20; // a request that has waited this long is rejected

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

class Pooler {
  constructor(size) { this.size = size; this.busy = []; this.queue = []; this.maxBusy = 0; this.served = 0; this.timedOut = 0; this.waits = []; }

  // One millisecond: finish queries, drop requests that waited too long, then lend free server connections to the queue in order.
  tick(now, arrivals) {
    this.busy = this.busy.filter((end) => end > now);
    this.queue.push(...arrivals.map((r) => ({ ...r, arrived: now })));
    while (this.queue.length > 0 && now - this.queue[0].arrived >= WAIT_LIMIT) { this.queue.shift(); this.timedOut++; }
    while (this.queue.length > 0 && this.busy.length < this.size) {
      const r = this.queue.shift();
      this.busy.push(now + r.duration); // the server connection is returned to the pool when the transaction ends
      this.waits.push(now - r.arrived);
      this.served++;
    }
    this.maxBusy = Math.max(this.maxBusy, this.busy.length);
  }
}

// 300 requests arrive within 100 ms (a burst) and each transaction takes 5 to 15 ms.
function makeBurst() {
  seed = 7;
  const byTime = Array.from({ length: 100 }, () => []);
  for (let i = 0; i < 300; i++) byTime[random(100)].push({ id: i, duration: 5 + random(11) });
  return byTime;
}

function run(size) {
  const burst = makeBurst();
  const pooler = new Pooler(size);
  for (let now = 0; now < 400; now++) pooler.tick(now, now < 100 ? burst[now] : []);
  const maxWait = Math.max(...pooler.waits);
  const avgWait = Math.floor(pooler.waits.reduce((a, b) => a + b, 0) / pooler.waits.length);
  console.log(`pool ${String(size).padStart(2)}: served ${pooler.served}, timed out ${pooler.timedOut}, max busy ${pooler.maxBusy}, max wait ${maxWait}, avg wait ${avgWait}`);
  if (pooler.maxBusy > size) throw new Error('the pool was exceeded');
  if (pooler.served + pooler.timedOut !== 300) throw new Error('a request was lost');
  return pooler.timedOut;
}

const failures = [8, 16, 32, 64].map(run);
if (failures.some((f, i) => i > 0 && f > failures[i - 1])) process.exit(1); // a bigger pool never rejects more

// Session state under transaction pooling: a client sets a value on its server connection, and a later transaction may land on another one.
function leaks(mode) {
  seed = 99;
  const own = new Map(); // what each client believes it set
  const state = new Map(); // what each server connection holds, keyed by client in session mode and by connection otherwise
  let wrong = 0;
  for (let step = 0; step < 300; step++) {
    const client = random(12);
    const conn = mode === 'session' ? `client${client}` : `conn${random(3)}`;
    if (random(2) === 0) { state.set(conn, client); own.set(client, true); } // SET timezone for this client
    else if (own.has(client) && state.get(conn) !== client) wrong++;          // SHOW timezone sees another client's value
  }
  return wrong;
}
const sessionWrong = leaks('session'), transactionWrong = leaks('transaction');
console.log(`wrong session state: session mode ${sessionWrong}, transaction mode ${transactionWrong}`);
if (sessionWrong !== 0 || transactionWrong === 0) process.exit(1);
