// A circuit breaker in JavaScript with closed, open and half-open states. The clock is passed in so the demo is deterministic.

const FAILURE_THRESHOLD = 3; // consecutive failures that open the breaker
const COOLDOWN_MS = 5000;     // how long it stays open before a half-open probe
const AFTER_COOLDOWN_MS = 6000; // demo time once the cooldown has passed

class CircuitBreaker {
  state = "closed";
  #failures = 0;
  #openedAt = 0;

  constructor(call, { failureThreshold = FAILURE_THRESHOLD, cooldownMs = COOLDOWN_MS, now = () => Date.now() } = {}) {
    this.call = call;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  async run(...args) {
    if (this.state === "open") {
      if (this.now() - this.#openedAt < this.cooldownMs) throw new Error("circuit open: failing fast");
      this.state = "half-open"; // cool-down over: allow a trial call
    }
    try {
      const result = await this.call(...args);
      this.state = "closed"; // success (also closes from half-open)
      this.#failures = 0;
      return result;
    } catch (error) {
      this.#failures++;
      if (this.state === "half-open" || this.#failures >= this.failureThreshold) {
        this.state = "open";
        this.#openedAt = this.now();
      }
      throw error;
    }
  }
}

let time = 0; // milliseconds, moved by hand
let paymentApiIsUp = false;
let realCalls = 0;
const payment = async () => {
  realCalls++;
  if (!paymentApiIsUp) throw new Error("payment API timed out");
  return "charged";
};
const breaker = new CircuitBreaker(payment, { failureThreshold: FAILURE_THRESHOLD, cooldownMs: COOLDOWN_MS, now: () => time });

async function checkout(label) {
  try {
    console.log(`t=${time}ms ${label}: ${await breaker.run()} (breaker ${breaker.state})`);
  } catch (e) {
    console.log(`t=${time}ms ${label}: ${e.message} (breaker ${breaker.state})`);
  }
}

for (const label of ["c1", "c2", "c3", "c4", "c5"]) await checkout(label); // c4 and c5 never reach the API
time = AFTER_COOLDOWN_MS;
paymentApiIsUp = true; // the provider recovered
await checkout("c6"); // half-open probe succeeds
await checkout("c7");
console.log(`real calls to the payment API: ${realCalls}`);
