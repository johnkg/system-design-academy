// A tiny durable workflow engine in JavaScript:
// the workflow is plain code, its history is an append-only list of results, and after a crash a new worker replays the code against the history.

const STEPS = ['reserve', 'charge', 'pack', 'ship', 'notify'];
const MAX_ATTEMPTS = 3;
const SEED = 7, ORDERS = 200;
const FAIL_PCT = 10, LOST_REPLY_PCT = 10, CRASH_PCT = 4; // an attempt fails early, or acts but its reply is lost; a worker dies before recording

class NeedActivity extends Error { constructor(name) { super(name); this.activity = name; } }

// The workflow must be deterministic: same history in, same decisions out. It may only touch the world through ctx.
function orderWorkflow(ctx) {
  const results = [];
  for (const step of STEPS) results.push(ctx.call(step)); // returns the recorded result, or pauses the code if there is none yet
  return results;
}

function replay(history) {
  let pos = 0;
  const ctx = { call(name) { if (pos < history.length) return history[pos++].result; throw new NeedActivity(name); } };
  return orderWorkflow(ctx);
}

let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Runs one order to the end. The activity is at-least-once: it can run, lose its reply, and be run again.
function runOrder(orderId, idempotent, effects, stats) {
  const history = [];
  for (;;) {
    let results = null;
    try { results = replay(history); } catch (e) { // a fresh worker starts here with nothing but the history
      if (!(e instanceof NeedActivity)) throw e;
      let done = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
        const r = random(100);
        if (r < FAIL_PCT) continue;                                  // failed before doing anything
        const key = `${orderId}:${e.activity}`;                 // the idempotency key
        if (!(idempotent && effects.has(key))) { effects.set(key, (effects.get(key) || 0) + 1); } // the side effect (a charge, a shipment)
        if (r < FAIL_PCT + LOST_REPLY_PCT) continue;                                  // the effect happened but the reply was lost
        done = true;
      }
      if (!done) { stats.stuck++; return history.length; }       // retries are used up: the workflow waits for a human
      if (random(100) < CRASH_PCT) { stats.crashes++; continue; }       // the worker died before it wrote the result: the activity will run again
      history.push({ type: 'ActivityCompleted', result: `${e.activity}-${orderId}` });
      continue;
    }
    stats.completed++;
    return history.length;
  }
}

function runAll(idempotent) {
  seed = SEED;
  const effects = new Map(), stats = { completed: 0, stuck: 0, crashes: 0 };
  let longest = 0;
  for (let id = 1; id <= ORDERS; id++) longest = Math.max(longest, runOrder(id, idempotent, effects, stats));
  let twice = 0, doubleCharges = 0;
  for (const [key, n] of effects) { twice += n - 1; if (key.endsWith(':charge')) doubleCharges += n - 1; }
  const events = 2 + 2 * longest; // started + one scheduled and one completed event per step + finished
  return { ...stats, twice, doubleCharges, events };
}

for (const idempotent of [false, true]) {
  const r = runAll(idempotent);
  console.log(`idempotent=${idempotent}: completed ${r.completed}, stuck ${r.stuck}, crashes ${r.crashes}, steps run twice ${r.twice}, double charges ${r.doubleCharges}, longest history ${r.events} events`);
  if (r.completed + r.stuck !== ORDERS) process.exit(1);
  if (idempotent && r.twice !== 0) process.exit(1);
  if (!idempotent && r.doubleCharges === 0) process.exit(1);
}
const again = replay([...STEPS].map((s) => ({ result: `${s}-9` })));
console.log(`replay of a full history gives: ${again.join(', ')}`);
if (again.join() !== 'reserve-9,charge-9,pack-9,ship-9,notify-9') process.exit(1);
