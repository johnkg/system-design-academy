// A lock service with leases and fencing tokens, in JavaScript:
// a paused holder loses its lease, a new holder gets a higher token, and the storage rejects the old token.
// All times are logical milliseconds, so the run is the same every time.

const TTL = 10000; // lease length

class LockService {
  constructor() { this.counter = 0; this.holder = null; this.expires = 0; }
  // Returns a fencing token, or 0 when someone else holds a live lease.
  acquire(who, now) {
    if (this.holder !== null && now < this.expires) return 0;
    this.holder = who; this.expires = now + TTL;
    return ++this.counter;
  }
  release(who) { if (this.holder === who) this.holder = null; }
  // A failover to an asynchronous replica: the newest grant and counter value were never copied.
  failover() { this.holder = null; this.counter -= 1; }
}

class Storage {
  constructor(fencing) { this.fencing = fencing; this.value = 100; this.maxToken = 0; }
  accept(token) { // the heart of fencing: remember the highest token, refuse any lower one
    if (this.fencing && token < this.maxToken) return false;
    this.maxToken = Math.max(this.maxToken, token);
    return true;
  }
  read(token) { return this.accept(token) ? this.value : null; }
  write(token, v) { if (!this.accept(token)) return false; this.value = v; return true; }
}

// Worker A reads, then stalls. Worker B takes the lock and does a full read-modify-write. A then writes.
function run(name, fencing, failover) {
  const lock = new LockService(), store = new Storage(fencing);
  const tokenA = lock.acquire('A', 0);
  const seenByA = store.read(tokenA);                       // A reads 100 at 500 ms
  if (lock.acquire('B', 1000) !== 0) throw new Error('B got a lock that A holds');
  if (failover) lock.failover();                            // at 2000 ms
  const bAt = failover ? 2500 : 10500, aWrites = failover ? 4500 : 19500;
  const tokenB = lock.acquire('B', bAt);                    // after the lease expired, or after the failover
  const seenByB = store.read(tokenB);
  store.write(tokenB, seenByB + 1);                         // B writes 101
  lock.release('B');
  const accepted = store.write(tokenA, seenByA + 1);        // A writes the stale result
  if (!accepted) {                                          // A learns it lost the lock and starts again
    const t = lock.acquire('A', aWrites + 500);
    store.write(t, store.read(t) + 1);
    lock.release('A');
  }
  console.log(`${name}: tokens A=${tokenA} B=${tokenB}; stale write ${accepted ? 'accepted' : 'rejected'}; final value ${store.value} (expected 102)`);
  return store.value;
}

const results = [
  run('no fencing           ', false, false),
  run('fencing, consensus   ', true, false),
  run('fencing, redis failover', true, true),
];
console.log(`results: ${results.join(', ')}`);

// Invariants: without fencing an update is lost; with monotonic tokens nothing is lost; a token counter that goes back defeats fencing.
if (results[0] !== 101 || results[1] !== 102 || results[2] !== 101) process.exit(1);
