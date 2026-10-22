// A bounded log buffer with three drop policies, in JavaScript:
// a burst of log lines meets a queue of fixed size, and the policy decides which lines are lost when it is full.

const LEVELS = ['debug', 'info', 'warn', 'error']; // index = priority
const CAPACITY = 300, DRAIN = 60, TICKS = 60;      // lines the buffer holds, lines shipped per tick, length of the run

const DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3;
const ERROR_PCT = 3, WARN_PCT = 7, INFO_PCT = 30; // the remaining 60% is debug
const SEED = 7, NORMAL_RATE = 30, BURST_RATE = 150, BURST_START = 20, BURST_END = 30; // lines per tick
let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const levelOf = (r) => (r < ERROR_PCT ? ERROR : r < ERROR_PCT + WARN_PCT ? WARN : r < ERROR_PCT + WARN_PCT + INFO_PCT ? INFO : DEBUG);

function run(policy) {
  seed = SEED;
  const queue = [], lost = LEVELS.map(() => 0), sent = LEVELS.map(() => 0);
  let arrived = 0, peak = 0;

  const offer = (level) => {
    if (queue.length < CAPACITY) { queue.push(level); return; }
    if (policy === 'drop-newest') { lost[level]++; return; }
    if (policy === 'drop-oldest') { lost[queue.shift()]++; queue.push(level); return; }
    const lowest = Math.min(...queue);       // keep-errors: make room by evicting the oldest line of the lowest level
    if (lowest < level) { queue.splice(queue.indexOf(lowest), 1); lost[lowest]++; queue.push(level); }
    else lost[level]++;
  };

  for (let t = 0; t < TICKS; t++) {
    const n = t >= BURST_START && t < BURST_END ? BURST_RATE : NORMAL_RATE; // a burst between ticks 20 and 29
    for (let i = 0; i < n; i++) { offer(levelOf(random(100))); arrived++; }
    peak = Math.max(peak, queue.length);
    for (let i = 0; i < DRAIN && queue.length > 0; i++) sent[queue.shift()]++;
  }
  while (queue.length > 0) sent[queue.shift()]++; // the agent catches up after the burst

  const total = (a) => a.reduce((x, y) => x + y, 0);
  const detail = LEVELS.map((name, i) => `${name} ${lost[i]}`).reverse().join(', ');
  console.log(`${policy}: shipped ${total(sent)} of ${arrived}, lost ${total(lost)} (${detail}), worst wait ${Math.floor((peak + DRAIN - 1) / DRAIN)} ticks`);
  return { arrived, lost, sent };
}

const results = {};
for (const policy of ['drop-newest', 'drop-oldest', 'keep-errors']) {
  const r = run(policy);
  results[policy] = r;
  if (r.lost.reduce((a, b) => a + b, 0) + r.sent.reduce((a, b) => a + b, 0) !== r.arrived) process.exit(1); // every line is either shipped or counted as lost
}
const ok = results['keep-errors'].lost[ERROR] === 0 && results['drop-newest'].lost[ERROR] > 0 && results['drop-oldest'].lost[ERROR] > 0;
console.log(`errors lost: ${['drop-newest', 'drop-oldest', 'keep-errors'].map((p) => results[p].lost[ERROR]).join(' / ')}; keep-errors loses none: ${ok}`);
if (!ok) process.exit(1);
