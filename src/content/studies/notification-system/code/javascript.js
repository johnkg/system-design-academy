// A notification sender in JavaScript: retries with backoff and idempotent sending.
// The provider and the waiting are simulated, so the output is deterministic.

class FakeProvider {
  delivered = [];
  #seenKeys = new Set();
  #attempts = new Map();
  constructor(behaviour) { this.behaviour = behaviour; } // id -> "ok" | "fail-first" | "lose-ack-first"

  send(id, idempotencyKey) {
    const attempt = (this.#attempts.get(id) ?? 0) + 1;
    this.#attempts.set(id, attempt);
    const behaviour = this.behaviour[id] ?? "ok";
    if (behaviour === "fail-first" && attempt === 1) throw new Error("503 provider unavailable"); // nothing delivered
    if (idempotencyKey && this.#seenKeys.has(idempotencyKey)) return "already delivered, ignored";
    this.delivered.push(id);
    if (idempotencyKey) this.#seenKeys.add(idempotencyKey);
    if (behaviour === "lose-ack-first" && attempt === 1) throw new Error("timeout waiting for answer"); // delivered, but we never hear it
    return "accepted";
  }
}

const MAX_ATTEMPTS = 3; // sends before the worker gives up
function sendWithRetry(provider, id, useKey, maxAttempts = MAX_ATTEMPTS) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const answer = provider.send(id, useKey ? id : undefined);
      console.log(`  ${id} attempt ${attempt}: ${answer}`);
      return;
    } catch (error) {
      const delay = 100 * 2 ** (attempt - 1); // exponential backoff (jitter left out to keep output fixed)
      console.log(`  ${id} attempt ${attempt}: ${error.message}${attempt < maxAttempts ? `; retry in ${delay} ms` : "; giving up (dead letter)"}`);
    }
  }
}

function run(title, useKey) {
  console.log(title);
  const provider = new FakeProvider({ A: "fail-first", B: "lose-ack-first", C: "ok" });
  for (const id of ["A", "B", "C"]) sendWithRetry(provider, id, useKey);
  const counts = ["A", "B", "C"].map((id) => `${id} x${provider.delivered.filter((d) => d === id).length}`);
  console.log(`  user received: ${counts.join(", ")}`);
}

run("Retries only (at least once):", false);
run("Retries plus idempotency key:", true);
