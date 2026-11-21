// Race conditions: a tiny deterministic scheduler runs EVERY interleaving of the threads' steps (no real threads, no clock).
// A step is one indivisible action; between two steps any other runnable thread may go first.
// Look for: the unsafe counter loses updates in most schedules; locking each step separately looks safe but is not;
// a lock, an atomic add and a compare-and-swap loop are correct in every schedule.
const LIMIT = 80;

// R read into a private copy, W write copy+1, A atomic add, L lock, U unlock, C compare-and-swap then retry on failure,
// K check the private copy (stop if too small), S subtract, D atomic check-and-subtract, X compare-and-swap subtract.
function program(scenario, variant, iters) {
  const one = {
    counter: {
      unsafe: ['R', 'W'],
      lock: ['L', 'R', 'W', 'U'],
      lockEach: ['L', 'R', 'U', 'L', 'W', 'U'],
      atomic: ['A'],
      cas: ['R', 'C'],
    },
    withdraw: {
      unsafe: ['R', 'K', 'S'],
      lock: ['L', 'R', 'K', 'S', 'U'],
      lockEach: ['L', 'R', 'U', 'K', 'L', 'S', 'U'],
      atomic: ['D'],
      cas: ['R', 'K', 'X'],
    },
  }[scenario][variant];
  let ops = [];
  for (let i = 0; i < iters; i++) ops = ops.concat(one);
  return ops;
}

function runnable(st, prog, i) {
  if (st.pc[i] >= prog.length) return false;
  return !(prog[st.pc[i]] === 'L' && st.owner !== -1);
}

// Executes one step of thread i and returns the new state (the old one is left alone).
function step(st, prog, i) {
  const s = { shared: st.shared, owner: st.owner, pc: st.pc.slice(), tmp: st.tmp.slice() };
  const op = prog[s.pc[i]];
  s.pc[i]++;
  if (op === 'R') s.tmp[i] = s.shared;
  else if (op === 'W') s.shared = s.tmp[i] + 1;
  else if (op === 'A') s.shared += 1;
  else if (op === 'S') s.shared -= LIMIT;
  else if (op === 'D') { if (s.shared >= LIMIT) s.shared -= LIMIT; }
  else if (op === 'L') s.owner = i;
  else if (op === 'U') s.owner = -1;
  else if (op === 'K') { if (s.tmp[i] < LIMIT) { if (s.owner === i) s.owner = -1; s.pc[i] = prog.length; } }
  else if (op === 'C') { if (s.shared === s.tmp[i]) s.shared = s.tmp[i] + 1; else s.pc[i] -= 2; }
  else if (op === 'X') { if (s.shared === s.tmp[i]) s.shared -= LIMIT; else s.pc[i] -= 3; }
  return s;
}

// Depth-first walk over every schedule. Returns how many there were and how many ended with a wrong value.
function explore(scenario, variant, threads, iters) {
  const prog = program(scenario, variant, iters);
  const expected = scenario === 'counter' ? threads * iters : 20;
  const start = { shared: scenario === 'counter' ? 0 : 100, owner: -1, pc: Array(threads).fill(0), tmp: Array(threads).fill(0) };
  const r = { total: 0, wrong: 0, deadlocks: 0, example: '-', lowest: 1000000 };
  const trail = [];
  function walk(st) {
    const ready = [];
    for (let i = 0; i < threads; i++) if (runnable(st, prog, i)) ready.push(i);
    if (ready.length === 0) {
      let done = true;
      for (let i = 0; i < threads; i++) if (st.pc[i] < prog.length) done = false;
      if (!done) { r.deadlocks++; return; }
      r.total++;
      if (st.shared < r.lowest) r.lowest = st.shared;
      if (st.shared !== expected) { r.wrong++; if (r.example === '-') r.example = trail.join(''); }
      return;
    }
    for (const i of ready) { trail.push(i); walk(step(st, prog, i)); trail.pop(); }
  }
  walk(start);
  return r;
}

const pad = (s, n) => String(s).padEnd(n);
const cases = [
  ['counter', 2, 1], ['counter', 2, 2], ['counter', 3, 1], ['withdraw', 2, 1],
];
for (const [scenario, threads, iters] of cases) {
  const what = scenario === 'counter' ? `${threads} threads x ${iters} increments, expected ${threads * iters}` : `${threads} threads each withdraw 80 from 100, expected 20 left`;
  console.log(`== ${scenario}: ${what}`);
  for (const variant of ['unsafe', 'lock', 'lockEach', 'atomic', 'cas']) {
    const r = explore(scenario, variant, threads, iters);
    console.log(`${pad(variant, 9)} interleavings=${pad(r.total, 6)} wrong=${pad(r.wrong, 6)} lowest=${pad(r.lowest, 5)} first bad schedule=${r.example}`);
  }
}
