// A job queue with leases, retries and a dead-letter queue in JavaScript:
// a job that is received but never finished comes back by itself, and doing it twice causes no harm.

class JobQueue {
  constructor(leaseSeconds, maxAttempts) {
    this.lease = leaseSeconds; this.maxAttempts = maxAttempts;
    this.jobs = new Map(); // id -> { id, attempts, visibleAt, done }
    this.deadLetters = [];
  }
  add(id) { this.jobs.set(id, { id, attempts: 0, visibleAt: 0, done: false }); }

  // Hand out the next job that is visible. It becomes invisible for the lease time; if nobody acks it, it will reappear.
  receive(now) {
    for (const job of this.jobs.values()) {
      if (job.done || job.visibleAt > now) continue;
      if (job.attempts >= this.maxAttempts) { job.done = true; this.deadLetters.push(job.id); continue; } // too many tries: set it aside for a person
      job.attempts++; job.visibleAt = now + this.lease;
      return job;
    }
    return null;
  }
  ack(id) { this.jobs.get(id).done = true; }
}

const effects = new Map(); // what the jobs actually did in the world (an invoice sent, for example)
const runLog = new Set();  // a record of finished work, keyed by job id

// The handler is idempotent: it first looks at the run log, so a repeat delivery does not repeat the effect.
function handle(job, worker, crashesAfterEffect) {
  if (job.id === 'poison') throw new Error('this job always fails');
  if (!runLog.has(job.id)) {
    effects.set(job.id, (effects.get(job.id) ?? 0) + 1); // the real work
    runLog.add(job.id);
  }
  if (crashesAfterEffect) throw new Error(`${worker} crashed after doing the work, before acknowledging it`);
}

const queue = new JobQueue(30, 3); // 30-second lease, at most 3 attempts
['invoice-1', 'invoice-2', 'poison'].forEach((id) => queue.add(id));

// Script of what goes wrong: worker A dies without doing invoice-1, worker B does invoice-2 but dies before the ack.
const crashPlan = { 'invoice-1': ['dies before starting'], 'invoice-2': ['crash after work'] };
const log = [];
for (let now = 0; now <= 200; now += 10) {
  const job = queue.receive(now);
  if (!job) continue;
  const plan = crashPlan[job.id]?.[job.attempts - 1];
  try {
    if (plan === 'dies before starting') throw new Error('worker A died');
    handle(job, 'B', plan === 'crash after work');
    queue.ack(job.id);
    log.push(`t=${now}s ${job.id} attempt ${job.attempts}: done`);
  } catch (e) {
    log.push(`t=${now}s ${job.id} attempt ${job.attempts}: ${e.message}`);
  }
}
console.log(log.join('\n'));
console.log(`effects: ${[...effects].sort().map(([id, n]) => `${id} x${n}`).join(', ')}   dead letters: ${queue.deadLetters.join(', ')}`);
if (effects.get('invoice-1') !== 1 || effects.get('invoice-2') !== 1 || queue.deadLetters.join() !== 'poison') process.exit(1);
