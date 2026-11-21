// Event loop: one thread, many tasks, simulated in ticks (no real timers, no clock).
// Part 1: handlers that read a shared counter, await some I/O, then write it back. One thread, yet updates are lost,
//         because other tasks run while a handler waits at an await.
// Part 2: 8 requests each wait 5 ticks for I/O and then need CPU time. A "ping" arrives at tick 6. How long do the
//         requests and the ping take when I/O blocks the loop, when it is awaited, when the CPU work is cut into slices,
//         and when it is moved to 2 worker threads?
// Look for: the lost update needs the await between read and write; a long CPU task delays everything queued behind it.
const IO = 5;

// R read the counter into a local copy, A await I/O (the task leaves the loop for IO ticks), W write copy+1,
// L take an async mutex (wait in line if it is held), U release it and wake the next waiter.
const HANDLERS = { gap: ['R', 'A', 'W'], tight: ['A', 'R', 'W'], mutex: ['L', 'R', 'A', 'W', 'U'] };

function handlers(variant, n) {
  const prog = HANDLERS[variant];
  const pc = Array(n).fill(0), tmp = Array(n).fill(0);
  const ready = [], timers = [], waiting = [];
  for (let i = 0; i < n; i++) ready.push(i);
  let counter = 0, now = 0, seq = 0, owner = -1;
  while (ready.length > 0 || timers.length > 0) {
    if (ready.length === 0) {
      now = Math.min(...timers.map((x) => x.at));
      const due = timers.filter((x) => x.at <= now).sort((a, b) => a.at - b.at || a.seq - b.seq);
      for (const d of due) { ready.push(d.task); timers.splice(timers.indexOf(d), 1); }
    }
    const i = ready.shift();
    let running = true;
    while (running && pc[i] < prog.length) {
      const op = prog[pc[i]];
      if (op === 'R') { tmp[i] = counter; pc[i]++; }
      else if (op === 'W') { counter = tmp[i] + 1; pc[i]++; }
      else if (op === 'A') { timers.push({ at: now + IO, seq: seq++, task: i }); pc[i]++; running = false; }
      else if (op === 'L') { if (owner === -1) { owner = i; pc[i]++; } else { waiting.push(i); pc[i]++; running = false; } }
      else if (op === 'U') { owner = -1; pc[i]++; if (waiting.length > 0) { owner = waiting.shift(); ready.push(owner); } }
    }
  }
  return { counter, ticks: now };
}

// Part 2. The loop runs one item at a time and an item is never interrupted unless it is cut into slices.
// blocking: the loop waits for each request's I/O itself. await: I/O overlaps, CPU runs on the loop in arrival order.
// chunked: like await, but CPU runs `slice` ticks at a time and the rest goes to the back of the queue.
// workers: CPU runs on `W` worker threads (one per core) and the loop stays free.
function loopSim(variant, R, io, cpu, slice, W, pingAt) {
  const loopQ = [], workQ = [];
  let cur = null, busy = 0, remaining = R + 1, pingDone = -1, total = 0, sum = 0;
  const workers = Array(W).fill(null);
  const finish = (id, t) => { remaining--; if (id < 0) pingDone = t; else { sum += t; if (t > total) total = t; } };
  for (let t = 0; remaining > 0; t++) {
    if (variant === 'blocking') { if (t === 0) for (let r = 0; r < R; r++) loopQ.push({ id: r, rem: io + cpu }); }
    else if (t === io) for (let r = 0; r < R; r++) (variant === 'workers' ? workQ : loopQ).push({ id: r, rem: cpu });
    if (t === pingAt) loopQ.push({ id: -1, rem: 1 });
    if (cur && cur.end === t) {
      cur.item.rem -= cur.len;
      if (cur.item.rem > 0) loopQ.push(cur.item); else finish(cur.item.id, t);
      cur = null;
    }
    for (let w = 0; w < W; w++) if (workers[w] && workers[w].end === t) { finish(workers[w].id, t); workers[w] = null; }
    if (!cur && loopQ.length > 0) {
      const item = loopQ.shift();
      const len = variant === 'chunked' && item.id >= 0 ? Math.min(item.rem, slice) : item.rem;
      cur = { item, len, end: t + len };
    }
    for (let w = 0; w < W; w++) if (!workers[w] && workQ.length > 0) { const item = workQ.shift(); workers[w] = { id: item.id, end: t + item.rem }; }
    if (cur) busy++;
    if (remaining === 0) total = Math.max(total, pingDone);
  }
  return { total, mean: Math.floor(sum / R), ping: pingDone - pingAt, busyPct: Math.floor((busy * 100) / total) };
}

console.log('== shared counter, one thread, each handler awaits 5 ticks of I/O');
for (const n of [2, 4]) for (const v of ['gap', 'tight', 'mutex']) {
  const r = handlers(v, n);
  console.log(`handlers=${n} ${v.padEnd(6)} final=${r.counter} expected=${n} ticks=${r.ticks}`);
}
console.log('== 8 requests, 5 ticks of I/O each, then CPU; ping at tick 6; slice 5, 2 workers');
for (const cpu of [2, 40]) for (const v of ['blocking', 'await', 'chunked', 'workers']) {
  const r = loopSim(v, 8, IO, cpu, 5, 2, 6);
  console.log(`cpu=${String(cpu).padEnd(3)} ${v.padEnd(9)} total=${String(r.total).padEnd(4)} mean=${String(r.mean).padEnd(4)} ping=${String(r.ping).padEnd(4)} loop busy%=${r.busyPct}`);
}
