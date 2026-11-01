// A miniature of the ideas in Stripe's 2017 posts "Scaling your API with rate limiters" and "Designing robust and
// predictable APIs with idempotency", in JavaScript (a teaching model, not Stripe's code):
// 1) a token bucket limits one user's request rate, 2) a load shedder keeps room for critical requests when the
// workers are short of capacity, 3) idempotency keys make a retried charge safe.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.

const BUCKET_SIZE = 3; // tokens a user's bucket holds, so a burst of 3 is allowed
const REFILL_PER_TICK = 1; // tokens added to the bucket each tick
const SCRIPT_REQUESTS_PER_TICK = 5; // a script that has run out of control
const SCRIPT_TICKS = 4;
const CAPACITY_PER_TICK = 10; // requests the workers can finish in one tick
const NON_CRITICAL_LIMIT = 5; // the shedder lets this many non-critical requests in per tick and keeps the rest for critical ones
const CRITICAL_PER_TICK = 4; // charges arriving each tick
const NON_CRITICAL_PER_TICK = 9; // requests to list old charges arriving each tick
const AMOUNT = 2000; // an example charge

// Request rate limiter: a token bucket. Each request takes a token, tokens drip back, an empty bucket rejects.
function tokenBucket() {
  console.log('--- request rate limiter: one script sends 5 requests a tick');
  let tokens = BUCKET_SIZE;
  let rejectedTotal = 0;
  for (let tick = 1; tick <= SCRIPT_TICKS; tick++) {
    const allowed = Math.min(SCRIPT_REQUESTS_PER_TICK, tokens);
    tokens = Math.min(BUCKET_SIZE, tokens - allowed + REFILL_PER_TICK);
    const rejected = SCRIPT_REQUESTS_PER_TICK - allowed;
    rejectedTotal += rejected;
    console.log(`tick ${tick}: sent ${SCRIPT_REQUESTS_PER_TICK}, allowed ${allowed}, rejected with 429: ${rejected}, tokens left ${tokens}`);
  }
  return rejectedTotal;
}

// Fleet usage load shedder: past its share of capacity, non-critical requests get a 503 so charges still fit.
// Without it, an overloaded tick finishes only part of every kind of request.
function loadShedding(useShedder) {
  const nonCriticalAdmitted = useShedder ? Math.min(NON_CRITICAL_PER_TICK, NON_CRITICAL_LIMIT) : NON_CRITICAL_PER_TICK;
  const load = CRITICAL_PER_TICK + nonCriticalAdmitted;
  const finished = (n) => (load > CAPACITY_PER_TICK ? Math.floor((n * CAPACITY_PER_TICK) / load) : n);
  const chargesDone = finished(CRITICAL_PER_TICK);
  const listsDone = finished(nonCriticalAdmitted);
  const shed = NON_CRITICAL_PER_TICK - nonCriticalAdmitted;
  console.log(`${useShedder ? 'with' : 'without'} the shedder: load ${load} of ${CAPACITY_PER_TICK}, charges done ${chargesDone} of ${CRITICAL_PER_TICK}, lists done ${listsDone}, lists shed with 503: ${shed}`);
  return chargesDone;
}

// Idempotency: the first time a key is seen the charge happens and its result is saved; a retry gets the saved result.
function charge(store, key, ledger) {
  if (store.has(key)) return { replayed: true, id: store.get(key) };
  ledger.push(AMOUNT); // the money moves once
  const id = `ch_${ledger.length}`;
  store.set(key, id);
  return { replayed: false, id };
}

function retriedCharge() {
  console.log('--- idempotency keys: the answer to the first attempt is lost, so the client tries again');
  const withoutKeys = [AMOUNT, AMOUNT]; // every attempt is a new charge
  console.log(`without a key: charges made ${withoutKeys.length}, the customer pays ${withoutKeys.length * AMOUNT}`);
  const store = new Map();
  const ledger = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = charge(store, 'key-1', ledger);
    console.log(`with key-1, attempt ${attempt}: ${result.replayed ? 'replayed the saved result' : 'charged'} ${result.id}`);
  }
  console.log(`with a key: charges made ${ledger.length}, the customer pays ${ledger.length * AMOUNT}`);
  return [withoutKeys.length, ledger.length];
}

const rejected = tokenBucket();
console.log('--- load shedding: 4 charges and 9 list requests arrive in a tick the workers can finish 10 requests of');
const chargesWithout = loadShedding(false);
const chargesWith = loadShedding(true);
const [chargesNoKey, chargesWithKey] = retriedCharge();
const ok = rejected === 14 && chargesWithout < CRITICAL_PER_TICK && chargesWith === CRITICAL_PER_TICK && chargesNoKey === 2 && chargesWithKey === 1;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
