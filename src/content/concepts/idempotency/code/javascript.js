// Idempotency keys in JavaScript: repeated requests with the same key run the work only once.

class PaymentApi {
  #seen = new Map(); // key -> { body, response }
  charges = [];

  charge(key, amount) {
    const existing = this.#seen.get(key);
    if (existing) {
      // same key, different body: a client bug, so refuse instead of guessing
      if (existing.amount !== amount) throw new Error(`key ${key} was already used with a different amount`);
      return { ...existing.response, replayed: true };
    }
    // In a real system, "check the key" and "do the work" must be one atomic step
    // (a database transaction or a unique constraint), or two simultaneous requests could both pass.
    this.charges.push(amount);
    const response = { status: "charged", amount, replayed: false };
    this.#seen.set(key, { amount, response });
    return response;
  }
}

const AMOUNT = 50, CHANGED_AMOUNT = 80; // dollars; the second is a different body under the same key
const api = new PaymentApi();

console.log("--- without reusing the key: the retry becomes a second payment");
api.charge("attempt-1", AMOUNT);
api.charge("attempt-2", AMOUNT); // the app made a new key on retry
console.log(`charges: [${api.charges}] total $${api.charges.reduce((a, b) => a + b, 0)}`);

const fresh = new PaymentApi();
const show = (r) => `{ status: ${r.status}, amount: ${r.amount}, replayed: ${r.replayed} }`;
console.log("--- reusing the key: the retry is a replay");
console.log(show(fresh.charge("abc-123", AMOUNT)));
console.log(show(fresh.charge("abc-123", AMOUNT))); // the response was lost, so the client retries with the same key
console.log(`charges: [${fresh.charges}] total $${fresh.charges.reduce((a, b) => a + b, 0)}`);

try {
  fresh.charge("abc-123", CHANGED_AMOUNT);
} catch (e) {
  console.log(`rejected: ${e.message}`);
}
