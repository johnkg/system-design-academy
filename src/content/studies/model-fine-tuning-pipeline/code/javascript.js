// A promotion gate and a training run that resumes from a checkpoint, in JavaScript.
// Scores are whole thousandths (800 means 0.800) so that every language prints the same numbers.
const MARGIN = 20, TOLERANCE = 10; // promote only if overall gains at least 0.020 and no slice drops by more than 0.010
const SLICES = ["short", "long", "non-english"];
const CURRENT = { overall: 800, short: 820, long: 760, "non-english": 700 };
const CANDIDATES = {
  A: { overall: 840, short: 860, long: 800, "non-english": 680 },
  B: { overall: 815, short: 830, long: 770, "non-english": 705 },
  C: { overall: 850, short: 870, long: 810, "non-english": 710 },
};

const fmt = (delta) => (delta < 0 ? "-" : "+") + "0." + String(Math.abs(delta)).padStart(3, "0");

function gate(candidate) {
  const gain = candidate.overall - CURRENT.overall;
  if (gain < MARGIN) return [false, `overall ${fmt(gain)} below the margin`];
  for (const name of SLICES) {
    const delta = candidate[name] - CURRENT[name];
    if (delta < -TOLERANCE) return [false, `overall ${fmt(gain)} ok, slice ${name} ${fmt(delta)} regressed`];
  }
  return [true, `overall ${fmt(gain)} ok, no slice regressed`];
}

console.log("gate: needs an overall gain of at least 0.020 and no slice down by more than 0.010");
for (const [name, scores] of Object.entries(CANDIDATES)) {
  const [promoted, reason] = gate(scores);
  console.log(`candidate ${name}: ${reason} -> ${promoted ? "promoted" : "rejected"}`);
}

// A run that is interrupted resumes from its newest complete checkpoint.
const TOTAL_STEPS = 10, CHECKPOINT_EVERY = 4, CRASH_AFTER = 7;
const storage = {};

function saveCheckpoint(step) {
  storage[`ckpt-${step}`] = { step }; // 1. write the data
  storage.latest = `ckpt-${step}`;    // 2. write the manifest last: a half-written checkpoint is never used
}

function train(first, crashAfter = null) {
  for (let step = first; step <= TOTAL_STEPS; step++) {
    if (step % CHECKPOINT_EVERY === 0) saveCheckpoint(step);
    if (step === crashAfter) throw new Error("node lost");
  }
}

console.log(`training ${TOTAL_STEPS} steps, checkpoint every ${CHECKPOINT_EVERY}, crash after step ${CRASH_AFTER}`);
try {
  train(1, CRASH_AFTER);
} catch {
  const saved = storage[storage.latest].step;
  console.log(`run 1: steps 1-${CRASH_AFTER}, crashed, last checkpoint at step ${saved}`);
  train(saved + 1);
  console.log(`run 2: resumed at step ${saved + 1}, finished at step ${TOTAL_STEPS}`);
  console.log(`work redone: ${CRASH_AFTER - saved} steps`);
}
