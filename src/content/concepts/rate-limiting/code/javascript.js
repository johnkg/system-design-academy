// A token bucket rate limiter in JavaScript. The clock is passed in so the demo is deterministic.

class TokenBucket {
  #tokens;
  #last;

  constructor(capacity, refillPerSecond, now) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.#tokens = capacity; // start full, so a new client can burst
    this.#last = now();
  }

  tryTake() {
    const t = this.now();
    // add the tokens earned since the last call, but never beyond the capacity
    this.#tokens = Math.min(this.capacity, this.#tokens + (t - this.#last) * this.refillPerSecond);
    this.#last = t;
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return true;
    }
    return false;
  }
}

const CAPACITY = 3; // burst size in tokens
const REFILL_PER_SECOND = 1;
let time = 0; // seconds, moved by hand
const bucket = new TokenBucket(CAPACITY, REFILL_PER_SECOND, () => time);

function request(label) {
  console.log(`t=${time}s ${label}: ${bucket.tryTake() ? "allowed" : "429 too many requests"}`);
}

["r1", "r2", "r3", "r4"].forEach(request); // a burst of 4 at once: the 4th is rejected
time = 1;
request("r5"); // one second later one token has refilled
request("r6"); // but only one
time = 10;
["r7", "r8", "r9", "r10"].forEach(request); // a long pause refills only up to the capacity (3)
