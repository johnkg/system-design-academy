// A gang scheduler for a small GPU cluster, in JavaScript:
// a job gets all its GPUs at once or waits, teams are ordered by fair share, placement keeps a big job inside one rack,
// and backfill lets short jobs use the gaps without delaying the job at the head of the queue.

const NODES = 8, PER_NODE = 8, RACK = 4; // 8 nodes of 8 GPUs, 2 racks of 4 nodes (64 GPUs)
const JOBS = 40;
const TEAMS = 3;
const MIN_DUR = 2; // job durations: 2..10 ticks
const DUR_SPREAD = 9;
const SUBMIT_WINDOW = 8; // jobs are submitted in ticks 0..7
const MAX_TICKS = 1000; // safety stop for the simulation
let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const sizes = [1, 2, 4, 8, 8, 16, 16, 32];
const jobs = Array.from({ length: JOBS }, (_, id) => ({ id, gpus: sizes[random(sizes.length)], team: random(TEAMS), dur: MIN_DUR + random(DUR_SPREAD), submit: random(SUBMIT_WINDOW) }));
jobs.sort((a, b) => a.submit * 100 + a.id - (b.submit * 100 + b.id));

// Returns [[node, count], ...] or null. Small jobs: the tightest node that fits. Big jobs: whole free nodes inside one rack.
function place(free, gpus) {
  if (gpus <= PER_NODE) {
    let best = -1;
    for (let n = 0; n < NODES; n++) if (free[n] >= gpus && (best < 0 || free[n] < free[best])) best = n;
    return best < 0 ? null : [[best, gpus]];
  }
  const need = gpus / PER_NODE;
  for (let r = 0; r < NODES / RACK; r++) {
    const whole = [];
    for (let n = r * RACK; n < (r + 1) * RACK; n++) if (free[n] === PER_NODE) whole.push([n, PER_NODE]);
    if (whole.length >= need) return whole.slice(0, need);
  }
  return null;
}

function run(backfill) {
  const free = new Array(NODES).fill(PER_NODE), usage = new Array(TEAMS).fill(0);
  const pending = jobs.map((j) => ({ ...j })), running = [];
  let done = 0, waitSum = 0, busy = 0, t = 0, started = 0;
  const start = (j, slots) => {
    slots.forEach(([n, c]) => { free[n] -= c; });
    if (slots.reduce((s, [, c]) => s + c, 0) !== j.gpus || free.some((f) => f < 0)) throw new Error('gang broken');
    j.slots = slots; j.end = t + j.dur; running.push(j); waitSum += t - j.submit; started++;
  };
  for (; done < jobs.length && t < MAX_TICKS; t++) {
    for (const j of running.filter((r) => r.end === t)) { j.slots.forEach(([n, c]) => { free[n] += c; }); done++; }
    running.splice(0, running.length, ...running.filter((r) => r.end !== t));
    const queue = pending.filter((j) => j.submit <= t && !j.slots).sort((a, b) => usage[a.team] - usage[b.team] || a.submit - b.submit || a.id - b.id);
    let shadow = -1; // when the blocked head could start, once the running jobs finish
    for (const j of queue) {
      if (shadow >= 0 && !(backfill && t + j.dur <= shadow)) continue;
      const slots = place(free, j.gpus);
      if (slots) { start(j, slots); continue; }
      if (shadow < 0) {
        if (!backfill) break;
        const copy = free.slice();
        for (const r of [...running].sort((a, b) => a.end - b.end)) { r.slots.forEach(([n, c]) => { copy[n] += c; }); if (place(copy, j.gpus)) { shadow = r.end; break; } }
      }
    }
    for (const r of running) { usage[r.team] += r.gpus; busy += r.gpus; }
  }
  if (done !== jobs.length || free.some((f) => f !== PER_NODE)) throw new Error('not all jobs finished');
  return { makespan: t, wait: Math.floor(waitSum / jobs.length), util: Math.floor((100 * busy) / (t * NODES * PER_NODE)), usage };
}

const fifo = run(false), fill = run(true);
console.log(`jobs: ${jobs.length}, GPUs requested in total: ${jobs.reduce((s, j) => s + j.gpus, 0)}, cluster: ${NODES * PER_NODE} GPUs`);
for (const [name, r] of [['strict queue', fifo], ['with backfill', fill]])
  console.log(`${name}: finished at t=${r.makespan}, average wait ${r.wait}, utilisation ${r.util}%, GPU-ticks per team ${r.usage.join('/')}`);
console.log(`backfill finishes ${fifo.makespan - fill.makespan} ticks earlier`);
