// Retry with exponential backoff and full jitter in JavaScript. Sleep and random are passed in so the demo is deterministic.

const MAX_ATTEMPTS = 5;
const FLAKY_FAILURES = 2, DOWN_ATTEMPTS = 3; // demo: failures before success, attempts for the dead service

async function retry(operation, { maxAttempts = MAX_ATTEMPTS, baseMs = 100, capMs = 2000, random = Math.random, sleep } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!error.retryable || attempt === maxAttempts) throw error; // give up: not worth retrying, or out of attempts
      const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1)); // 100, 200, 400, 800 ...
      const delay = Math.floor(random() * ceiling);                  // full jitter: anywhere from 0 to the ceiling
      console.log(`attempt ${attempt} failed (${error.message}); waiting ${delay} ms`);
      await sleep(delay);
    }
  }
}

const sleep = async () => {}; // a real version would wait; here we only print the chosen delay
const fixedRandom = () => 0.5;

// A service that fails twice with a temporary error, then works
const flaky = async (attempt) => {
  if (attempt <= FLAKY_FAILURES) throw Object.assign(new Error("503 unavailable"), { retryable: true });
  return `ok on attempt ${attempt}`;
};
console.log(await retry(flaky, { random: fixedRandom, sleep }));

// A permanent error is not retried at all
const notFound = async () => { throw Object.assign(new Error("404 not found"), { retryable: false }); };
try {
  await retry(notFound, { random: fixedRandom, sleep });
} catch (e) {
  console.log(`gave up immediately: ${e.message}`);
}

// A service that never recovers: stops after the maximum attempts
const down = async () => { throw Object.assign(new Error("503 unavailable"), { retryable: true }); };
try {
  await retry(down, { maxAttempts: DOWN_ATTEMPTS, random: fixedRandom, sleep });
} catch (e) {
  console.log(`gave up after 3 attempts: ${e.message}`);
}
