// A job service: idempotent create, status, leased workers and a polling comparison.
// The clock is an integer "second" that the loop advances by hand, so the output is deterministic.
import assert from "node:assert";

const LEASE = 4; // a worker renews its lease every second; if it stops, the job is re-queued after 4 s

function* lcg(seed) {
  let state = seed;
  while (true) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    yield state;
  }
}

class JobService {
  constructor(workers, seed) {
    this.jobs = new Map();
    this.byKey = new Map();
    this.queue = [];
    this.results = new Map();
    this.workers = new Array(workers).fill(null);
    this.downUntil = new Array(workers).fill(0); // a crashed worker restarts after 2 s
    this.random = lcg(seed);
  }

  log(t, job, text) {
    console.log(`t=${String(t).padStart(2)} op_${job.id} ${text}`);
  }

  // POST /reports: the same key always returns the same operation.
  create(t, key) {
    if (this.byKey.has(key)) return this.byKey.get(key);
    const work = 6 + (this.random.next().value % 10);
    const job = { id: this.jobs.size + 1, state: "pending", work, left: work, lease: 0, runs: 0 };
    this.jobs.set(job.id, job);
    this.byKey.set(key, job.id);
    this.queue.push(job);
    this.log(t, job, `pending (${job.work} s of work)`);
    return job.id;
  }

  // GET /operations/{id}
  status(opId) {
    return this.jobs.get(opId).state;
  }

  tick(t, crashWorker = -1) {
    if (crashWorker >= 0 && this.workers[crashWorker]) {
      const job = this.workers[crashWorker];
      this.log(t, job, `worker ${crashWorker} crashed, lease stays at t=${job.lease}`);
      this.workers[crashWorker] = null; // the job stays 'running' until its lease expires
      this.downUntil[crashWorker] = t + 2;
    }
    for (const job of this.jobs.values()) {
      if (job.state === "running" && job.lease <= t && !this.workers.includes(job)) {
        job.state = "pending";
        job.left = job.work; // start over from the beginning
        this.queue.unshift(job);
        this.log(t, job, "lease expired, back to pending");
      }
    }
    this.workers.forEach((job, i) => {
      if (!job) return;
      job.left -= 1;
      job.lease = t + LEASE;
      if (job.left === 0) {
        job.state = "succeeded";
        this.results.set(job.id, `report-${job.id}`); // a put under the job id, so a re-run overwrites
        this.workers[i] = null;
        this.log(t, job, `succeeded after ${job.runs} run(s)`);
      }
    });
    this.workers.forEach((job, i) => {
      if (job === null && this.queue.length && t >= this.downUntil[i]) {
        const next = (this.workers[i] = this.queue.shift());
        next.state = "running";
        next.runs += 1;
        next.lease = t + LEASE;
        this.log(t, next, `running on worker ${i}`);
      }
    });
  }
}

const svc = new JobService(2, 7);
const a = svc.create(0, "key-a");
svc.create(0, "key-b");
const aAgain = svc.create(0, "key-a"); // the client retried a lost 202
assert.ok(aAgain === a && svc.jobs.size === 2, "same key must return the same job");
svc.create(1, "key-c");
let t = 0;
while ([...svc.jobs.values()].some((j) => j.state !== "succeeded")) {
  t += 1;
  svc.tick(t, t === 4 ? 0 : -1);
  assert.ok(t < 100);
}
assert.ok(svc.results.size === 3 && [...svc.jobs.values()].every((j) => j.state === "succeeded"));
console.log(`jobs: ${svc.jobs.size}, results stored: ${svc.results.size}, runs: [${[...svc.jobs.values()].map((j) => j.runs).join(", ")}]`);

// Poll at `first` seconds, then wait growth*previous (capped at 16); stop when the job is done.
function pollTimes(doneAt, first, growth) {
  const times = [];
  let wait = first;
  let now = 0;
  while (true) {
    now += wait;
    times.push(now);
    if (now >= doneAt) return times;
    wait = Math.min(16, wait * growth);
  }
}

const fixed = pollTimes(45, 1, 1);
const backoff = pollTimes(45, 2, 2);
console.log(`fixed 1 s: ${fixed.length} polls, result seen at ${fixed.at(-1)} s`);
console.log(`backoff 2,4,8,16: ${backoff.length} polls, result seen at ${backoff.at(-1)} s`);
assert.ok(backoff.length < fixed.length && backoff.at(-1) - 45 < 16);
console.log(`1,000,000 clients: ${1000000} req/s fixed, ${Math.floor((1000000 * backoff.length) / 45)} req/s average with backoff`);
