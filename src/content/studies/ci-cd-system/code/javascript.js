// The core of a CI system in JavaScript: a pipeline DAG, content-addressed cache keys,
// timing-based test sharding and a fair-share scheduler.

// 1. A pipeline is a DAG: each job lists the jobs it needs. Jobs in the same layer can run at the same time.
const pipeline = { lint: [], build: [], test: ['build'], package: ['test', 'lint'] };
function layers(jobs) {
  const names = Object.keys(jobs), done = new Set(), out = [];
  while (done.size < names.length) {
    const ready = names.filter((j) => !done.has(j) && jobs[j].every((need) => done.has(need)));
    if (ready.length === 0) throw new Error('the pipeline has a cycle');
    out.push(ready); ready.forEach((j) => done.add(j));
  }
  return out;
}

// 2. A cache key is a hash of the content that decides the result, so equal inputs give the same key and any change gives a new one.
function hash(text) { // FNV-1a, 32 bits
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}
const cacheKey = (os, lockfile) => `deps-${os}-${hash(lockfile)}`;

// 3. Test sharding: put the slowest test first on the least loaded shard (greedy), using the timings of earlier runs.
const SEED = 99, TEST_COUNT = 12, MIN_TEST_S = 10, TEST_SPREAD_S = 170, SHARDS = 4;
const JOB_MINUTES = 3, RUNNERS = 2, TEAM_A_JOBS = 8;
let seed = SEED;
const rand = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };
function shard(tests, k) {
  const loads = Array(k).fill(0);
  const sorted = [...tests].sort((a, b) => b.secs - a.secs || (a.name < b.name ? -1 : 1));
  for (const t of sorted) loads[loads.indexOf(Math.min(...loads))] += t.secs;
  return loads;
}

// 4. Scheduling: all jobs wait at time 0 and each takes 3 minutes. First come first served, or the team with the fewest running jobs goes next.
function schedule(jobs, runners, fair) {
  const free = Array(runners).fill(0), pending = [...jobs], spans = [], start = {};
  while (pending.length > 0) {
    const t = Math.min(...free), r = free.indexOf(t);
    const running = (team) => spans.filter((s) => s.team === team && s.start <= t && t < s.end).length;
    let pick = 0;
    if (fair) for (let i = 1; i < pending.length; i++) if (running(pending[i].team) < running(pending[pick].team)) pick = i;
    const job = pending.splice(pick, 1)[0];
    spans.push({ team: job.team, start: t, end: t + JOB_MINUTES }); start[job.id] = t; free[r] = t + JOB_MINUTES;
  }
  return start;
}

const lay = layers(pipeline);
console.log(`pipeline layers: ${lay.map((l) => l.join('+')).join(' > ')}`);

const lock = 'left-pad 1.3.0\nreact 18.2.0\nzod 3.22.4\n';
const same = cacheKey('linux', lock) === cacheKey('linux', 'left-pad 1.3.0\nreact 18.2.0\nzod 3.22.4\n');
const changed = cacheKey('linux', lock) === cacheKey('linux', lock.replace('18.2.0', '18.3.1'));
console.log(`cache key ${cacheKey('linux', lock)}; same lockfile same key: ${same}; one version changed, same key: ${changed}`);

const tests = Array.from({ length: TEST_COUNT }, (_, i) => ({ name: `t${String(i + 1).padStart(2, '0')}`, secs: MIN_TEST_S + rand(TEST_SPREAD_S) }));
const total = tests.reduce((s, t) => s + t.secs, 0), longest = Math.max(...tests.map((t) => t.secs));
const loads = shard(tests, SHARDS);
const roundRobin = Array(SHARDS).fill(0); tests.forEach((t, i) => (roundRobin[i % SHARDS] += t.secs));
console.log(`one shard takes ${total} s; 4 shards by timing: ${loads.join(', ')} s; 4 shards by name: ${roundRobin.join(', ')} s`);

const jobs = [...Array.from({ length: TEAM_A_JOBS }, (_, i) => ({ team: 'A', id: `A${i + 1}` })), { team: 'B', id: 'B1' }, { team: 'B', id: 'B2' }];
const waitB = (s) => Math.max(s.B1, s.B2);
const fifo = schedule(jobs, RUNNERS, false), fair = schedule(jobs, RUNNERS, true);
console.log(`team B waits at most ${waitB(fifo)} min first come first served, and ${waitB(fair)} min with fair share`);

const ok = lay.length === 3 && same && !changed
  && Math.max(...loads) * SHARDS <= total + longest * (SHARDS - 1) && loads.reduce((a, b) => a + b, 0) === total
  && waitB(fair) < waitB(fifo);
if (!ok) process.exit(1);
