// A tiny stream engine in JavaScript: keyed state, tumbling event-time windows, watermarks,
// checkpoints, and recovery by restoring state and replaying the log. Integers only, so it is deterministic.
const WINDOW = 10, DELAY = 4, EVERY = 50; // window length, watermark lag behind the newest event time, checkpoint interval (events)

const KEY_SLOTS = 10; // a state id is window start * 10 + key, so keys must stay below 10
const SEED = 7, EVENTS = 2000, KEYS = 5, EVENTS_PER_TICK = 4, MAX_LATENESS = 8, MAX_VALUE = 9;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const events = Array.from({ length: EVENTS }, (_, i) => ({ key: rnd(KEYS), time: Math.max(0, Math.floor(i / EVENTS_PER_TICK) - rnd(MAX_LATENESS)), value: 1 + rnd(MAX_VALUE) })); // arrive out of order

class Job {
  constructor() { this.offset = 0; this.maxTime = -1; this.windows = new Map(); this.out = []; this.late = 0; this.lateSum = 0; }
  fire(limit) { // emit every window that ends at or before the watermark, oldest first
    const ready = [...this.windows.keys()].filter((id) => Math.floor(id / KEY_SLOTS) + WINDOW <= limit).sort((a, b) => a - b);
    for (const id of ready) { this.out.push([id, this.windows.get(id)]); this.windows.delete(id); }
  }
  step() {
    const e = this.events[this.offset++];
    const start = e.time - (e.time % WINDOW), id = start * KEY_SLOTS + e.key; // the state is keyed by (key, window)
    this.maxTime = Math.max(this.maxTime, e.time);
    const watermark = this.maxTime - DELAY;
    if (start + WINDOW <= watermark) { this.late++; this.lateSum += e.value; } // its window has already fired
    else this.windows.set(id, (this.windows.get(id) ?? 0) + e.value);
    this.fire(watermark);
  }
  snapshot() { return { offset: this.offset, maxTime: this.maxTime, windows: new Map(this.windows), outLen: this.out.length, late: this.late, lateSum: this.lateSum }; }
  restore(s, transactionalSink) {
    Object.assign(this, { offset: s.offset, maxTime: s.maxTime, windows: new Map(s.windows), late: s.late, lateSum: s.lateSum });
    if (transactionalSink) this.out.length = s.outLen; // uncommitted output is aborted
  }
}
Job.prototype.events = events;

function run(crashes, transactionalSink) {
  const job = new Job(); let snap = job.snapshot(), next = 0, replayed = 0;
  while (job.offset < events.length) {
    if (next < crashes.length && job.offset === crashes[next]) { next++; replayed += job.offset - snap.offset; job.restore(snap, transactionalSink); continue; }
    job.step();
    if (job.offset % EVERY === 0) snap = job.snapshot();
  }
  job.fire(Infinity); // the stream ended: flush what is left
  return { job, replayed };
}

const checksum = (out) => out.reduce((h, [id, sum]) => (h * 131 + id * 1000 + sum) % 1000003, 0);
const total = events.reduce((s, e) => s + e.value, 0);
const crashes = [130, 410, 777, 1499];

const ref = run([], true).job;
console.log(`no crash: ${ref.out.length} windows, late dropped ${ref.late}, checksum ${checksum(ref.out)}`);
const sum = (j) => j.out.reduce((s, [, v]) => s + v, 0) + j.lateSum;
const exact = run(crashes, true);
const same = JSON.stringify(exact.job.out) === JSON.stringify(ref.out);
console.log(`4 crashes, transactional sink: replayed ${exact.replayed} events, identical output: ${same}`);
const naive = run(crashes, false).job;
console.log(`4 crashes, plain sink: ${naive.out.length} rows, ${naive.out.length - ref.out.length} duplicates`);
console.log(`first rows: ${ref.out.slice(0, 3).map(([id, v]) => `key ${id % KEY_SLOTS} @${Math.floor(id / KEY_SLOTS)} = ${v}`).join('; ')}`);

if (!same || sum(ref) !== total || sum(exact.job) !== total || naive.out.length <= ref.out.length) process.exit(1);
