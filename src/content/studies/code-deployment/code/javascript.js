// A staged rollout with a canary, health gates, automatic rollback and a deploy lock, in JavaScript.
// Error rates are counted per thousand requests so that all the arithmetic is in whole numbers.
const HOSTS = 1000, CANARY = 10, BATCH = 100, REQS = 200, BASE = 2, LIMIT = 10;

let seed = 7;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const fails = (rate) => (next() >>> 8) % 1000 < rate; // one request fails with the given chance per thousand

const fleet = new Array(HOSTS).fill(1); // the version each host runs
let lock = null;                        // the version whose deploy holds the lock, or null

// Roll a version out in waves: a small canary first, then batches. Each wave is judged by its own error rate
// before the next one starts, and a failed gate puts the previous version back on every host that changed.
function deploy(version, bug, limit, during) {
  if (lock !== null) return { status: `refused, v${lock} is deploying`, hosts: 0, errors: 0 };
  lock = version;
  try {
    const previous = fleet[0];
    let done = 0, errors = 0;
    for (let size = CANARY; done < HOSTS; size = BATCH) {
      size = Math.min(size, HOSTS - done);
      for (let i = done; i < done + size; i++) fleet[i] = version;
      done += size;
      let wave = 0;
      for (let r = 0; r < size * REQS; r++) if (fails(BASE + bug)) wave++; // traffic served by the new hosts
      errors += wave;
      if (during && done === CANARY) during();
      if (wave * 1000 > size * REQS * limit) { // the gate: error rate above the limit
        for (let i = 0; i < HOSTS; i++) if (fleet[i] === version) fleet[i] = previous;
        return { status: `rolled back after ${done} hosts`, hosts: done, errors };
      }
    }
    return { status: 'complete', hosts: done, errors };
  } finally { lock = null; }
}
const running = (v) => fleet.filter((x) => x === v).length;

// 1. A release with a bug that fails 3% of requests, with the gate on. A second deploy tries to start during it.
let second;
const gated = deploy(2, 30, LIMIT, () => { second = deploy(9, 0, LIMIT); });
console.log(`v2 with the gate: ${gated.status}, ${gated.errors} errors; v1 on ${running(1)} hosts`);
console.log(`second deploy meanwhile: ${second.status}`);

// 2. The same release with the gate switched off reaches every host.
const ungated = deploy(2, 30, 1000);
console.log(`v2 without a gate: ${ungated.status} on ${running(2)} hosts, ${ungated.errors} errors`);
fleet.fill(1);

// 3. A good release passes every gate even though 0.2% of requests fail anyway.
const good = deploy(3, 0, LIMIT);
console.log(`v3 without the bug: ${good.status} on ${running(3)} hosts, ${good.errors} errors`);

const ok = gated.hosts === CANARY && gated.errors * 20 < ungated.errors && second.hosts === 0 && lock === null
  && good.status === 'complete' && running(3) === HOSTS;
console.log(`rollback worked, lock respected, no false alarm: ${ok}`);
if (!ok) process.exit(1);
