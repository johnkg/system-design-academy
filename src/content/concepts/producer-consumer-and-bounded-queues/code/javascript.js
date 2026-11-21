// Producer-consumer: a tick simulation (no real threads, no clock) of one producer feeding 3 consumers through a queue.
// The producer offers `rate` items per tick for 60 ticks. Each consumer needs 2 ticks per item, so the consumers can
// take 1.5 items per tick. The queue is unbounded or holds at most `bound` items, and when it is full the producer is
// blocked, or the new item is dropped, or the oldest queued item is dropped.
// With `retry` on, every 4th item fails once and its consumer puts it back on the SAME queue to try again.
// Look for: rate 2 is more than the consumers can take, so an unbounded queue just grows; a bound turns that into
// waiting (block) or loss (drop); blocking plus retry-on-the-same-queue can deadlock.
const TICKS = 60, CONSUMERS = 3, SERVICE = 2;

function simulate(rate, bound, policy, retry) {
  const total = rate * TICKS;
  const queue = [];
  const cons = Array.from({ length: CONSUMERS }, () => ({ state: 'idle', rem: 0, item: null }));
  let firstLost = -1, produced = 0, processed = 0, lost = 0, peak = 0, maxWait = 0, blocked = 0, ticks = 0, deadlock = false;
  const full = () => bound > 0 && queue.length >= bound;
  // Offers an item to the queue under the policy. Returns true if it was handled (queued or dropped), false if blocked.
  const offer = (item, t) => {
    if (!full()) { item.enq = t; queue.push(item); return true; }
    if (policy === 'block') return false;
    if (policy === 'dropNew') { lost++; if (firstLost < 0) firstLost = item.id; return true; }
    const old = queue.shift(); lost++; if (firstLost < 0) firstLost = old.id; item.enq = t; queue.push(item); return true;
  };
  for (let t = 0; t < 3000; t++) {
    for (const c of cons) {
      if (c.state === 'busy' && --c.rem === 0) {
        if (retry && c.item.id % 4 === 3 && !c.item.failed) { c.item.failed = true; c.state = 'putting'; }
        else { processed++; c.state = 'idle'; c.item = null; }
      }
    }
    for (const c of cons) if (c.state === 'putting' && offer(c.item, t)) { c.state = 'idle'; c.item = null; }
    for (const c of cons) {
      if (c.state === 'idle' && queue.length > 0) {
        c.item = queue.shift(); c.state = 'busy'; c.rem = SERVICE;
        if (t - c.item.enq > maxWait) maxWait = t - c.item.enq;
      }
    }
    for (let k = 0; k < rate && produced < total; k++) {
      if (offer({ id: produced, enq: t, failed: false }, t)) produced++; else { blocked++; break; }
    }
    if (queue.length > peak) peak = queue.length;
    ticks = t + 1;
    if (produced === total && queue.length === 0 && cons.every((c) => c.state === 'idle')) break;
    if (policy === 'block' && full() && cons.every((c) => c.state === 'putting')) { deadlock = true; break; }
  }
  return { total, processed, lost, firstLost, peak, maxWait, blocked, ticks, deadlock };
}

const pad = (s, n) => String(s).padEnd(n);
const show = (label, r) =>
  console.log(`${pad(label, 22)} ${r.deadlock ? `DEADLOCK at tick ${pad(r.ticks, 3)}` : `finished at tick ${pad(r.ticks, 3)}`} processed=${pad(r.processed, 3)} lost=${pad(r.lost, 3)} first lost=${pad(r.firstLost < 0 ? '-' : r.firstLost, 3)} high-water=${pad(r.peak, 3)} longest wait=${pad(r.maxWait, 3)} producer blocked=${r.blocked}`);
console.log('== producer offers 1 item per tick (the consumers can take 1.5)');
show('unbounded', simulate(1, 0, 'block', false));
console.log('== producer offers 2 items per tick, 120 items in all');
show('unbounded', simulate(2, 0, 'block', false));
show('bound 10, block', simulate(2, 10, 'block', false));
show('bound 10, drop newest', simulate(2, 10, 'dropNew', false));
show('bound 10, drop oldest', simulate(2, 10, 'dropOld', false));
show('bound 1, block', simulate(2, 1, 'block', false));
console.log('== same, but every 4th item fails once and is put back on the same queue');
show('unbounded', simulate(2, 0, 'block', true));
show('bound 10, block', simulate(2, 10, 'block', true));
show('bound 10, drop newest', simulate(2, 10, 'dropNew', true));
