// A job service for 4 tenants, second by second for 500 seconds. Tenant 0 is the noisy one: it submits a burst of 12
// jobs a second between 100 s and 200 s. The three others submit one job a second each. A job needs 2 core-seconds on
// a 16-core machine. Running more jobs at once than there are cores shares the cores and wastes some on switching.
// Some jobs fail, some after their side effect already happened. A deploy can restart the workers at 151 s.
// Everything is integers from a seeded generator, so the output never changes.
const TICKS = 500, TENANTS = 4;
const CORES = 16;            // cores per machine
const COST = 2000;           // work units a job needs; a core does 1,000 a second
const MAX_THREADS = 250;     // a thread per job: past this many at once the process runs out of memory and dies
const BURST_AT = 100, BURST_END = 200, BURST = 12;
const QMAX = 200, FAIR_QMAX = 50; // bounded queue: all tenants together, or per tenant
const FAIL_PCT = 10, EFFECT_PCT = 50, MAX_TRIES = 3; // a failure happens after the side effect half of the time
const RESTART_AT = 151, DRAIN = 10, GAP = 5;
const CHECK_EVERY = 10, WAIT_LIMIT = 5, BOOT = 20, MAX_MACHINES = 4; // autoscaler on the age of the oldest job
const SLICE = 25;

function rate(n, cores) {
  if (n <= cores) return 1000;
  const ovh = Math.min(600, (n - cores) * 8);
  return Math.floor((Math.floor((1000 * cores) / n) * (1000 - ovh)) / 1000);
}

function run(name, { exec, queue, noisy, retry, deploy }) {
  let seed = 4242;
  const rnd = () => (seed = (seed * 48271) % 2147483647);
  const shared = [], per = [[], [], [], []];
  const pending = [];
  let running = [], machines = 1, rr = 0, paused = false, resumeAt = -1, drainEnd = -1;
  const sub = [0, 0], rej = [0, 0], done = [0, 0]; // [noisy, others]
  const lat = new Map();
  let nextId = 0, lost = 0, lostOthers = 0, crashes = 0, killed = 0, dup = 0, failed = 0, dead = 0, peak = 0, machineTicks = 0;
  const g = (tenant) => (tenant === 0 ? 0 : 1);
  const queued = () => (queue === 'fair' ? per.reduce((s, q) => s + q.length, 0) : shared.length);
  const lose = (j) => { lost++; if (j.tenant !== 0) lostOthers++; };
  const answer = (j, t) => { if (j.tenant !== 0) { const d = t - j.t0 + 1; lat.set(d, (lat.get(d) ?? 0) + 1); } }; // the caller got an answer
  const finish = (j, t) => { done[g(j.tenant)]++; answer(j, t); };
  const requeue = (j) => (queue === 'fair' ? per[j.tenant] : shared).push(j);
  const workers = () => (exec === 'thread' ? 1e9 : exec === 'auto' ? CORES * machines : Number(exec));
  for (let t = 0; t < TICKS; t++) {
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i] <= t) { machines++; pending.splice(i, 1); }
    for (let tenant = 0; tenant < TENANTS; tenant++) {
      const n = tenant === 0 ? (noisy && t >= BURST_AT && t < BURST_END ? BURST : t % 2 === 0 ? 1 : 0) : 1;
      for (let k = 0; k < n; k++) {
        const j = { id: nextId++, tenant, t0: t, tries: 0, prog: 0, effect: false };
        sub[g(tenant)]++;
        if (exec === 'thread') running.push(j);
        else if (queue === 'fair') { if (per[tenant].length >= FAIR_QMAX) rej[g(tenant)]++; else per[tenant].push(j); }
        else if (queue === 'bounded' && shared.length >= QMAX) rej[g(tenant)]++;
        else shared.push(j);
      }
    }
    if (exec === 'thread' && running.length > MAX_THREADS) { crashes++; for (const j of running) lose(j); running = []; }
    if (t === RESTART_AT && deploy !== 'none') {
      if (exec === 'thread' || deploy === 'abrupt') {
        for (const j of running) { killed++; if (exec === 'thread' || retry === 'none') lose(j); else { j.prog = 0; requeue(j); } }
        running = []; resumeAt = exec === 'thread' ? t : t + GAP;
      } else { paused = true; drainEnd = t + DRAIN; }
    }
    if (paused && (running.length === 0 || t >= drainEnd)) {
      for (const j of running) { killed++; if (retry === 'none') lose(j); else { j.prog = 0; requeue(j); } }
      running = []; paused = false; resumeAt = t + GAP;
    }
    if (exec === 'auto' && t % CHECK_EVERY === 0) {
      let oldest = 0;
      for (const q of queue === 'fair' ? per : [shared]) if (q.length) oldest = Math.max(oldest, t - q[0].t0);
      if (oldest > WAIT_LIMIT && machines + pending.length < MAX_MACHINES) pending.push(t + BOOT);
      else if (queued() === 0 && machines > 1 && pending.length === 0) machines--;
    }
    if (exec !== 'thread' && !paused && t >= resumeAt) {
      while (running.length < workers() && queued() > 0) {
        if (queue === 'fair') {
          let tenant = rr;
          while (per[tenant].length === 0) tenant = (tenant + 1) % TENANTS;
          running.push(per[tenant].shift());
          rr = (tenant + 1) % TENANTS;
        } else running.push(shared.shift());
      }
    }
    machineTicks += exec === 'auto' ? machines : 1;
    peak = Math.max(peak, running.length);
    const r = rate(running.length, CORES * (exec === 'auto' ? machines : 1));
    const still = [];
    for (const j of running) {
      j.prog += r;
      if (j.prog < COST) { still.push(j); continue; }
      if (rnd() % 100 >= FAIL_PCT) { if (j.effect) dup++; j.effect = true; finish(j, t); continue; }
      if (rnd() % 100 < EFFECT_PCT) { if (j.effect) dup++; j.effect = true; }
      if (retry === 'none') { failed++; answer(j, t); continue; }
      if (j.effect && retry === 'idem') { finish(j, t); continue; }
      j.tries++;
      if (j.tries >= MAX_TRIES) { dead++; answer(j, t); continue; }
      j.prog = 0;
      if (exec === 'thread') still.push(j); else requeue(j);
    }
    running = still;
  }
  const admitted = sub[1] - rej[1];
  const keys = [...lat.keys()].sort((a, b) => a - b);
  let seen = 0, p95 = -1;
  for (const k of keys) { seen += lat.get(k); if (p95 < 0 && seen * 100 >= admitted * 95) p95 = k; }
  console.log(`-- ${name}`);
  console.log(`  other tenants: p95 ${p95 < 0 || p95 > TICKS ? 'over 500 s' : `${p95} s`}; ${done[1]} of ${sub[1]} done, ${rej[1]} rejected, ${lostOthers} lost`);
  console.log(`  noisy tenant: ${done[0]} of ${sub[0]} done, ${rej[0]} rejected`);
  console.log(`  peak ${peak} running at once, ${crashes} crashes, ${killed} killed by the deploy, ${lost} jobs lost, ${machineTicks} machine-seconds`);
  console.log(`  duplicate side effects ${dup}, failed without retry ${failed}, given up after ${MAX_TRIES} tries ${dead}`);
  if (done[0] + done[1] + rej[0] + rej[1] > sub[0] + sub[1]) throw new Error('impossible count');
}

const base = { exec: '16', queue: 'unbounded', noisy: true, retry: 'none', deploy: 'none' };
run('a thread per job, noisy tenant', { ...base, exec: 'thread' });
run('16 workers, one unbounded queue', base);
run('64 workers, one unbounded queue', { ...base, exec: '64' });
run('16 workers, bounded queue of 200', { ...base, queue: 'bounded' });
run('16 workers, fair queues of 50 each', { ...base, queue: 'fair' });
run('autoscaled, fair queues', { ...base, exec: 'auto', queue: 'fair' });
run('16 workers, fair, no noisy tenant', { ...base, queue: 'fair', noisy: false });
run('16 workers, fair, retries without idempotency', { ...base, queue: 'fair', retry: 'retry' });
run('16 workers, fair, retries with idempotency', { ...base, queue: 'fair', retry: 'idem' });
run('16 workers, fair, idempotent, abrupt restart', { ...base, queue: 'fair', retry: 'idem', deploy: 'abrupt' });
run('16 workers, fair, idempotent, drain then restart', { ...base, queue: 'fair', retry: 'idem', deploy: 'drain' });
