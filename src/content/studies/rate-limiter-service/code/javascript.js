// Three rate limiting algorithms in JavaScript, tried on a burst that straddles a window boundary.
// Limit: 10 requests per second. Times are in milliseconds and passed in, so the demo is deterministic.

class FixedWindow {
  #window = -1;
  #count = 0;
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; }
  allow(t) {
    const window = Math.floor(t / this.windowMs);
    if (window !== this.#window) { this.#window = window; this.#count = 0; } // a new window starts a new count
    if (this.#count >= this.limit) return false;
    this.#count++;
    return true;
  }
}

class SlidingWindowLog {
  #times = [];
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; }
  allow(t) {
    while (this.#times.length && this.#times[0] <= t - this.windowMs) this.#times.shift(); // forget old requests
    if (this.#times.length >= this.limit) return false;
    this.#times.push(t);
    return true;
  }
}

class TokenBucket {
  #tokens;
  #last = 0;
  constructor(capacity, refillPerSecond) { this.capacity = capacity; this.refillPerSecond = refillPerSecond; this.#tokens = capacity; }
  allow(t) {
    this.#tokens = Math.min(this.capacity, this.#tokens + ((t - this.#last) / 1000) * this.refillPerSecond);
    this.#last = t;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

// 10 requests in the last 100 ms of one second, and 10 more in the first 100 ms of the next
const times = [];
for (let k = 0; k < 10; k++) times.push(2900 + k * 10);
for (let k = 0; k < 10; k++) times.push(3000 + k * 10);

function run(name, allow) {
  const allowed = times.filter((t) => allow(t));
  const worst = Math.max(...allowed.map((t) => allowed.filter((u) => u >= t && u < t + 1000).length));
  console.log(`${name}: allowed ${allowed.length} of ${times.length}, most in any 1 s: ${worst}`);
}

run("fixed window     ", (() => { const l = new FixedWindow(10, 1000); return (t) => l.allow(t); })());
run("sliding log      ", (() => { const l = new SlidingWindowLog(10, 1000); return (t) => l.allow(t); })());
run("token bucket     ", (() => { const l = new TokenBucket(10, 10); return (t) => l.allow(t); })());

// Three gateways that each count on their own (the first attempt): requests rotate between them
const gateways = [0, 1, 2].map(() => new FixedWindow(10, 1000));
let turn = 0;
run("3 separate gates ", (t) => gateways[turn++ % 3].allow(t));
