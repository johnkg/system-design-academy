// Locks: a deterministic scheduler (no real threads, no clock) for two questions.
// Part 1 walks EVERY interleaving of threads that take locks in some order and counts the schedules that end in deadlock.
// Part 2 is a tick model of contention: threads alternate work outside a lock and a critical section behind a lock.
// Look for: opposite lock order deadlocks in some schedules, the same order never does; one coarse lock is safe
// but, once the lock is busy all the time, more threads stop helping.
const NAMES = 'ABCG';

// "L0" take lock 0 (A), "U0" release it, "W" do the work. The locks are not re-entrant: taking a lock you hold blocks you.
const SCENARIOS = {
  opposite: [['L0', 'L1', 'W', 'U1', 'U0'], ['L1', 'L0', 'W', 'U0', 'U1']],
  ordered: [['L0', 'L1', 'W', 'U1', 'U0'], ['L0', 'L1', 'W', 'U1', 'U0']],
  ring: [['L0', 'L1', 'W', 'U1', 'U0'], ['L1', 'L2', 'W', 'U2', 'U1'], ['L2', 'L0', 'W', 'U0', 'U2']],
  ringOrdered: [['L0', 'L1', 'W', 'U1', 'U0'], ['L1', 'L2', 'W', 'U2', 'U1'], ['L0', 'L2', 'W', 'U2', 'U0']],
  reentry: [['L0', 'L0', 'W', 'U0', 'U0'], ['L0', 'L0', 'W', 'U0', 'U0']],
  coarse: [['L3', 'W', 'U3'], ['L3', 'W', 'U3']],
};

function explore(progs) {
  const n = progs.length;
  const r = { complete: 0, deadlocked: 0, example: '-', stuck: '-' };
  const trail = [];
  const canRun = (st, i) => st.pc[i] < progs[i].length && !(progs[i][st.pc[i]][0] === 'L' && st.owner[Number(progs[i][st.pc[i]].slice(1))] !== -1);
  function walk(st) {
    const ready = [];
    for (let i = 0; i < n; i++) if (canRun(st, i)) ready.push(i);
    if (ready.length === 0) {
      const unfinished = [];
      for (let i = 0; i < n; i++) if (st.pc[i] < progs[i].length) unfinished.push(i);
      if (unfinished.length === 0) { r.complete++; return; }
      r.deadlocked++;
      if (r.example === '-') {
        r.example = trail.join('');
        r.stuck = unfinished.map((i) => {
          const holds = [];
          for (let l = 0; l < 4; l++) if (st.owner[l] === i) holds.push(NAMES[l]);
          return `T${i} holds ${holds.length ? holds.join('') : 'nothing'} wants ${NAMES[Number(progs[i][st.pc[i]].slice(1))]}`;
        }).join(' | ');
      }
      return;
    }
    for (const i of ready) {
      const owner = st.owner.slice(), pc = st.pc.slice();
      const op = progs[i][pc[i]];
      pc[i]++;
      if (op[0] === 'L') owner[Number(op.slice(1))] = i;
      if (op[0] === 'U') owner[Number(op.slice(1))] = -1;
      trail.push(i); walk({ owner, pc }); trail.pop();
    }
  }
  walk({ owner: [-1, -1, -1, -1], pc: Array(n).fill(0) });
  return r;
}

// Part 2. Each thread does `jobs` jobs: `outside` ticks of work that needs no lock, then `hold` ticks inside one lock chosen
// from `locks` of them (job number + thread number, modulo the lock count). A busy lock is queued in arrival order.
function contention(threads, locks, hold, outside, jobs) {
  const phase = Array(threads).fill('out'), rem = Array(threads).fill(outside), job = Array(threads).fill(0);
  const owner = Array(locks).fill(-1), queue = Array.from({ length: locks }, () => []);
  const target = (i) => (i + job[i]) % locks;
  let finished = 0, t = 0, waiting = 0, longest = 0;
  while (finished < threads) {
    for (let i = 0; i < threads; i++) {
      if (phase[i] === 'out') { if (--rem[i] === 0) { phase[i] = 'wait'; queue[target(i)].push(i); } }
      else if (phase[i] === 'hold') {
        if (--rem[i] === 0) {
          owner[target(i)] = -1; job[i]++;
          if (job[i] === jobs) { phase[i] = 'done'; finished++; } else { phase[i] = 'out'; rem[i] = outside; }
        }
      }
    }
    for (let l = 0; l < locks; l++) if (owner[l] === -1 && queue[l].length > 0) { const i = queue[l].shift(); owner[l] = i; phase[i] = 'hold'; rem[i] = hold; }
    for (let l = 0; l < locks; l++) { waiting += queue[l].length; if (queue[l].length > longest) longest = queue[l].length; }
    t++;
  }
  return { ticks: t, waiting, longest, alone: threads * jobs * (outside + hold) };
}

console.log('== lock order: every interleaving');
for (const name of Object.keys(SCENARIOS)) {
  const r = explore(SCENARIOS[name]);
  console.log(`${name.padEnd(12)} threads=${SCENARIOS[name].length} schedules=${String(r.complete + r.deadlocked).padEnd(5)} deadlocked=${String(r.deadlocked).padEnd(5)} first=${r.example} stuck: ${r.stuck}`);
}
console.log('== contention: 20 jobs per thread, 20 ticks of work outside the lock');
for (const hold of [2, 20]) for (const locks of [1, 4]) for (const threads of [1, 2, 4, 8, 16]) {
  const c = contention(threads, locks, hold, 20, 20);
  const waitPct = Math.floor((c.waiting * 100) / (threads * c.ticks));
  console.log(`hold=${String(hold).padEnd(3)} locks=${locks} threads=${String(threads).padEnd(3)} ticks=${String(c.ticks).padEnd(6)} speedup_x10=${String(Math.floor((c.alone * 10) / c.ticks)).padEnd(4)} waiting%=${String(waitPct).padEnd(3)} longest queue=${c.longest}`);
}
