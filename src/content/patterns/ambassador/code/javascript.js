// Ambassador in JavaScript. The app asks the ambassador for a rate; the ambassador deals with the flaky partner.

const RATES = { EUR: "1.08", GBP: "1.27", JPY: "0.0067", USD: "1.00" };
const FAILING_CALLS = new Set([1, 3, 4, 5]); // the partner's calls that fail
let calls = 0;
function partner(currency) { // the remote service
  calls += 1;
  if (FAILING_CALLS.has(calls)) throw new Error("partner error");
  return RATES[currency];
}

class Ambassador { // Runs beside the client: backs off between retries, and stops calling a partner that is clearly down.
  // Timeouts are left out of this toy; real code sets one on every call. Backoff delays are printed, not slept.
  constructor({ maxAttempts = 3, openAfter = 3, probeAfter = 1 } = {}) {
    Object.assign(this, { maxAttempts, openAfter, probeAfter, consecutiveFailures: 0, skipped: 0, calls: 0 });
  }

  get(currency) {
    const open = this.consecutiveFailures >= this.openAfter;
    if (open && this.skipped < this.probeAfter) { // circuit open: fail fast, leave the partner alone
      this.skipped += 1;
      console.log("[ambassador] circuit open, partner not called");
      throw new Error("circuit open");
    }
    const attempts = open ? 1 : this.maxAttempts; // half-open: one probe call decides whether to close the circuit
    for (let attempt = 1; attempt <= attempts; attempt++) {
      this.calls += 1;
      try {
        const rate = partner(currency);
        console.log(`[ambassador] call ${this.calls} ok${open ? " (probe, circuit closes)" : ""}`);
        this.consecutiveFailures = 0;
        this.skipped = 0;
        return rate;
      } catch {
        this.consecutiveFailures += 1;
        const delay = 100 * 2 ** (attempt - 1); // exponential backoff: 100 ms, 200 ms, ...
        console.log(`[ambassador] call ${this.calls} failed, ${attempt < attempts ? `retrying in ${delay} ms` : "giving up"}`);
      }
    }
    this.skipped = 0; // a failed probe keeps the circuit open for another round
    throw new Error(`partner failed ${attempts} times`);
  }
}

const ambassador = new Ambassador();
for (const currency of ["EUR", "GBP", "JPY", "USD"]) { // the app only asks; it has no retry code
  console.log(`app asks for ${currency}`);
  try {
    console.log(`${currency} = ${ambassador.get(currency)}`);
  } catch (error) {
    console.log(`${currency} unavailable: ${error.message}`);
  }
}
