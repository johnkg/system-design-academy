// Thread pool: a tick simulation (no real threads, no clock) of jobs waiting in a queue for a fixed set of worker threads.
// The machine has 4 cores. A thread that waits for I/O keeps its place in the pool but uses no core. When more threads
// want a core than there are cores, the cores are shared round-robin. Model assumption: a tick is one unit of work;
// switching between threads costs nothing here, although real thread switching and memory per thread do cost something.
// Look for: IO jobs need about 12 threads (arrival rate x time in system); more than that gains nothing; CPU jobs gain
// nothing beyond 4 threads; fan-out jobs that wait for a sub-job in the SAME pool deadlock when the pool is small.
const CORES = 4;
const WORKLOADS = {
  cpu: { jobs: 60, gap: 1 },    // 8 ticks of CPU each, one job per tick
  io: { jobs: 60, gap: 1 },     // 2 ticks of CPU, then 10 ticks waiting for I/O
  fanout: { jobs: 30, gap: 1 }, // 1 tick CPU, submit a 3-tick child to the same pool and wait for it, then 1 tick CPU
};

function simulate(workload, pool, qbound) {
  const w = WORKLOADS[workload];
  const queue = [];
  const th = Array.from({ length: pool }, () => ({ state: 'free', rem: 0, job: null, last: -1, phase: 0 }));
  let next = 0, rejected = 0, done = 0, sumLat = 0, peakQueue = 0, peakThreads = 0, ticks = 0, deadlock = false;
  const accepted = () => w.jobs - rejected;
  const complete = (x, t) => {
    if (x.job.kind === 'job') { done++; sumLat += t + 1 - x.job.arrive; }
    else { const p = th[x.job.parent]; p.state = 'cpu'; p.rem = 1; p.phase = 2; }
    x.state = 'free'; x.job = null;
  };
  for (let t = 0; t < 5000; t++) {
    if (next < w.jobs && t % w.gap === 0) {
      if (qbound > 0 && queue.length >= qbound) rejected++; else queue.push({ kind: 'job', arrive: t });
      next++;
    }
    for (const x of th) {
      if (x.state === 'free' && queue.length > 0) {
        x.job = queue.shift(); x.phase = 1; x.state = 'cpu';
        x.rem = workload === 'cpu' ? 8 : workload === 'io' ? 2 : x.job.kind === 'child' ? 3 : 1;
      }
    }
    if (queue.length > peakQueue) peakQueue = queue.length;
    let busy = 0;
    for (const x of th) if (x.state !== 'free') busy++;
    if (busy > peakThreads) peakThreads = busy;
    const running = th.map((x, i) => i).filter((i) => th[i].state === 'cpu').sort((a, b) => th[a].last - th[b].last || a - b).slice(0, CORES);
    for (const i of running) { th[i].rem--; th[i].last = t; }
    for (let i = 0; i < pool; i++) if (th[i].state === 'io') th[i].rem--;
    for (let i = 0; i < pool; i++) {
      const x = th[i];
      if (x.rem !== 0) continue;
      if (x.state === 'cpu') {
        if (workload === 'io' && x.phase === 1) { x.phase = 2; x.state = 'io'; x.rem = 10; }
        else if (workload === 'fanout' && x.job.kind === 'job' && x.phase === 1) { queue.push({ kind: 'child', parent: i }); x.state = 'blocked'; x.rem = -1; }
        else complete(x, t);
      } else if (x.state === 'io') complete(x, t);
    }
    ticks = t + 1;
    if (done === accepted() && next === w.jobs) break;
    if (th.every((x) => x.state === 'blocked')) { deadlock = true; break; }
  }
  return { done, rejected, ticks, peakQueue, peakThreads, mean: done ? Math.floor(sumLat / done) : 0, perHundred: Math.floor((done * 100) / ticks), deadlock };
}

const pad = (s, n) => String(s).padEnd(n);
for (const [workload, pools] of [['cpu', [2, 4, 8, 64]], ['io', [4, 8, 12, 16, 64]], ['fanout', [2, 4, 8, 12, 16]]]) {
  console.log(`== ${workload}: ${WORKLOADS[workload].jobs} jobs, one every ${WORKLOADS[workload].gap} tick(s), unbounded queue`);
  for (const pool of pools) {
    const r = simulate(workload, pool, 0);
    console.log(`pool=${pad(pool, 3)} ${r.deadlock ? `DEADLOCK at tick ${r.ticks}, ${r.done} done` : `ticks=${pad(r.ticks, 5)} done=${r.done}`} per100=${pad(r.perHundred, 4)} mean latency=${pad(r.mean, 4)} peak queue=${pad(r.peakQueue, 3)} peak threads=${r.peakThreads}`);
  }
}
console.log('== io, pool 8: bounded queue of 10 rejects, unbounded keeps everything');
for (const q of [0, 10]) {
  const r = simulate('io', 8, q);
  console.log(`queue bound=${pad(q === 0 ? 'none' : q, 5)} done=${pad(r.done, 3)} rejected=${pad(r.rejected, 3)} mean latency=${pad(r.mean, 4)} peak queue=${r.peakQueue}`);
}
