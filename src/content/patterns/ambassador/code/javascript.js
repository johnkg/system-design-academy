// Ambassador in JavaScript. The app asks the ambassador for a rate; the ambassador deals with the flaky partner.

const RATES = { EUR: "1.08", GBP: "1.27", JPY: "0.0067" };
const FAILING_CALLS = new Set([1, 3, 4, 5]); // the partner's calls that fail
let calls = 0;
function partner(currency) { // the remote service
  calls += 1;
  if (FAILING_CALLS.has(calls)) throw new Error("partner error");
  return RATES[currency];
}

class Ambassador { // Runs beside the client: retries with a limit, and stops calling a partner that is clearly down
  constructor({ maxAttempts = 3, openAfter = 3 } = {}) {
    this.maxAttempts = maxAttempts;
    this.openAfter = openAfter;
    this.consecutiveFailures = 0;
    this.calls = 0;
  }

  get(currency) {
    if (this.consecutiveFailures >= this.openAfter) {
      console.log("[ambassador] circuit open, partner not called");
      throw new Error("circuit open");
    }
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      this.calls += 1;
      try {
        const rate = partner(currency);
        console.log(`[ambassador] call ${this.calls} ok`);
        this.consecutiveFailures = 0;
        return rate;
      } catch {
        this.consecutiveFailures += 1;
        console.log(`[ambassador] call ${this.calls} failed, ${attempt < this.maxAttempts ? "retrying" : "giving up"}`);
      }
    }
    throw new Error(`partner failed ${this.maxAttempts} times`);
  }
}

const ambassador = new Ambassador();
for (const currency of ["EUR", "GBP", "JPY"]) { // the app only asks; it has no retry code
  console.log(`app asks for ${currency}`);
  try {
    console.log(`${currency} = ${ambassador.get(currency)}`);
  } catch (error) {
    console.log(`${currency} unavailable: ${error.message}`);
  }
}
