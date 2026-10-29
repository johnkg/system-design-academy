// A miniature of the idea in Slack's "Scaling Slack's Job Queue" (2017), in JavaScript (a teaching model, not Slack's code):
// a durable log (Kafka's role) sits in front of a small in-memory queue (Redis's role). A relay moves jobs from the log
// to the queue under a rate limit and moves its offset forward only after the queue accepted the job.
// The first run has no log, so a full queue rejects new jobs. The second run uses the log.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.

const PARTITIONS = 2; // log partitions (Slack's topics have 32)
const REDIS_LIMIT = 4; // jobs the in-memory queue can hold
const RATE = 2; // most jobs the relay may write to the queue per tick
const DRAIN = 1; // jobs the workers finish per tick
const BURST_TICKS = 4; // ticks in which new jobs arrive
const PER_TICK = 3; // new jobs per tick
const REDIS_DOWN_TICK = 3; // a tick in which the queue cannot be written to

// 32-bit FNV-1a, used to choose a partition from the job id.
function fnv(text) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

// Ids of the jobs arriving in a tick. Job 2 is sent twice in tick 1, as a client retry might do.
function arrivals(tick) {
  if (tick > BURST_TICKS) return [];
  const ids = Array.from({ length: PER_TICK }, (_, i) => `job-${(tick - 1) * PER_TICK + i + 1}`);
  if (tick === 1) ids[2] = 'job-2';
  return ids;
}

function redisAdd(queue, job) {
  // Limited deduplication: a job whose id is already waiting is discarded.
  if (queue.includes(job)) return 'duplicate';
  queue.push(job);
  return 'added';
}

function direct() {
  console.log('--- without a log: producers write straight to the queue');
  let queue = [], rejected = 0;
  for (let tick = 1; tick <= BURST_TICKS; tick++) {
    let lost = 0;
    for (const job of arrivals(tick)) {
      if (queue.length >= REDIS_LIMIT) lost++;
      else redisAdd(queue, job);
    }
    rejected += lost;
    queue = queue.slice(DRAIN);
    console.log(`tick ${tick}: arrived ${PER_TICK}, rejected ${lost}, queue ${queue.length}`);
  }
  console.log(`rejected in total: ${rejected}`);
  return rejected;
}

function withLog() {
  console.log('--- with a log in front: producers append to the log, a relay feeds the queue');
  const log = Array.from({ length: PARTITIONS }, () => []);
  const offset = Array(PARTITIONS).fill(0); // next entry the relay will read, per partition
  let queue = [];
  const done = [];
  for (let tick = 1; tick < 30; tick++) {
    for (const job of arrivals(tick)) log[fnv(job) % PARTITIONS].push(job); // always accepted
    let moved = 0;
    if (tick !== REDIS_DOWN_TICK) {
      for (let p = 0; p < PARTITIONS; p++) {
        while (moved < RATE && offset[p] < log[p].length && queue.length < REDIS_LIMIT) {
          redisAdd(queue, log[p][offset[p]]);
          offset[p]++; // committed only after the queue took the job
          moved++;
        }
      }
    }
    done.push(...queue.slice(0, DRAIN));
    queue = queue.slice(DRAIN);
    let lag = 0;
    for (let p = 0; p < PARTITIONS; p++) lag += log[p].length - offset[p];
    const note = tick === REDIS_DOWN_TICK ? ' (queue unreachable)' : '';
    console.log(`tick ${tick}: arrived ${arrivals(tick).length}, relayed ${moved}, queue ${queue.length}, waiting in log ${lag}${note}`);
    if (tick > BURST_TICKS && lag === 0 && queue.length === 0) break;
  }
  return done;
}

const rejected = direct();
const done = withLog();
console.log(`finished ${done.length} distinct jobs, none rejected, first ${done[0]}, last ${done[done.length - 1]}`);
const ok = rejected > 0 && done.length === new Set(done).size && done.length === BURST_TICKS * PER_TICK - 1;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
