// A bounded log buffer with three drop policies, in JavaScript:
// a burst of log lines meets a queue of fixed size, and the policy decides which lines are lost when it is full.

const LEVELS = ['debug', 'info', 'warn', 'error']; // index = priority
const CAPACITY = 300, DRAIN = 60, TICKS = 60;      // lines the buffer holds, lines shipped per tick, length of the run

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const levelOf = (r) => (r < 3 ? 3 : r < 10 ? 2 : r < 40 ? 1 : 0); // 3% errors, 7% warnings, 30% info, 60% debug

function run(policy) {
  seed = 7;
  const queue = [], lost = [0, 0, 0, 0], sent = [0, 0, 0, 0];
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
    const n = t >= 20 && t < 30 ? 150 : 30;  // a burst between ticks 20 and 29
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
const ok = results['keep-errors'].lost[3] === 0 && results['drop-newest'].lost[3] > 0 && results['drop-oldest'].lost[3] > 0;
console.log(`errors lost: ${['drop-newest', 'drop-oldest', 'keep-errors'].map((p) => results[p].lost[3]).join(' / ')}; keep-errors loses none: ${ok}`);
if (!ok) process.exit(1);
