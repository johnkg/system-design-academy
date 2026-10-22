// A hierarchical timing wheel with cancellation, in JavaScript:
// three levels of 64 slots, so a timer is placed once in O(1), moves down a level when its turn comes, and fires on exactly its tick.

const BITS = 6, SLOTS = 1 << BITS, LEVELS = 3; // level 0 = 1 tick per slot, level 1 = 64 ticks, level 2 = 4,096 ticks

class TimingWheel {
  constructor() {
    this.now = 0;
    this.levels = Array.from({ length: LEVELS }, () => Array.from({ length: SLOTS }, () => []));
    this.cancelled = new Set();
    this.moved = [0, 0, 0]; // how many timers each level handed down
  }

  // The farther away the due tick, the coarser the level that holds the timer.
  add(timer) {
    const delta = timer.due - this.now;
    let level = 0;
    while (level < LEVELS - 1 && delta >= 1 << (BITS * (level + 1))) level++;
    this.levels[level][(timer.due >> (BITS * level)) & (SLOTS - 1)].push(timer);
    return level;
  }

  cancel(id) { this.cancelled.add(id); } // lazy: the timer is skipped when its slot comes up

  // Advance one tick: cascade the coarse slots that start now, then fire the fine slot.
  tick() {
    this.now++;
    for (let level = LEVELS - 1; level >= 1; level--) {
      if (this.now % (1 << (BITS * level)) !== 0) continue;
      const slot = (this.now >> (BITS * level)) & (SLOTS - 1);
      const moving = this.levels[level][slot];
      this.levels[level][slot] = [];
      this.moved[level] += moving.length;
      for (const t of moving) this.add(t);
    }
    const slot = this.now & (SLOTS - 1);
    const due = this.levels[0][slot];
    this.levels[0][slot] = [];
    return due.filter((t) => !this.cancelled.has(t.id)).sort((a, b) => a.id - b.id);
  }
}

const SEED = 2024, HORIZON = 200000; // ticks simulated
const FIRST_BATCH = 3000, LATE_BATCH = 200, LATE_AT = 1000, LATE_HORIZON = 150000;
const CANCEL_EVERY = 10, CANCEL_ID_END = 3; // ids ending in 3 are cancelled: 10%
let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 256) % n; };

const wheel = new TimingWheel();
const timers = [];
const placed = [0, 0, 0];
const schedule = (id, due) => { const t = { id, due }; timers.push(t); placed[wheel.add(t)]++; };

for (let id = 0; id < FIRST_BATCH; id++) schedule(id, 1 + random(HORIZON));
for (const t of timers) if (t.id % CANCEL_EVERY === CANCEL_ID_END) wheel.cancel(t.id); // 10% are cancelled before they are due

const fired = [];
let onTime = true;
while (wheel.now < HORIZON) {
  if (wheel.now === LATE_AT) { // new timers keep arriving while the wheel turns
    for (let id = FIRST_BATCH; id < FIRST_BATCH + LATE_BATCH; id++) schedule(id, wheel.now + 1 + random(LATE_HORIZON));
    for (const t of timers) if (t.id >= FIRST_BATCH && t.id % CANCEL_EVERY === CANCEL_ID_END) wheel.cancel(t.id);
  }
  for (const t of wheel.tick()) { fired.push(t); if (t.due !== wheel.now) onTime = false; }
}

const expected = timers.filter((t) => !wheel.cancelled.has(t.id)).sort((a, b) => a.due - b.due || a.id - b.id);
const sameOrder = JSON.stringify(fired) === JSON.stringify(expected);
console.log(`timers ${timers.length}, cancelled ${wheel.cancelled.size}, fired ${fired.length}`);
console.log(`placed on arrival by level: L0 ${placed[0]}, L1 ${placed[1]}, L2 ${placed[2]}`);
console.log(`first 5 fired: ${fired.slice(0, 5).map((t) => `#${t.id}@${t.due}`).join(', ')}`);
console.log(`cascaded down: ${wheel.moved[2]} from level 2, ${wheel.moved[1]} from level 1`);
console.log(`every timer fired on its own tick: ${onTime}; same order as a full sort: ${sameOrder}`);
if (!onTime || !sameOrder || fired.length !== timers.length - wheel.cancelled.size) process.exit(1);
