// An image pipeline under a bulk import, second by second for 20 minutes. Sellers upload 10 photos a second; each
// photo takes a worker 2 seconds (6 variants). At 60 s a big seller imports 100,000 photos at once. Some images are
// broken and make a worker spend 30 seconds before it gives up. Everything is integers, so the output never changes.
const END = 1200;          // seconds simulated
const LIVE_PER_S = 10;     // photos a second from sellers editing their listings
const COST = 2;            // worker-seconds per photo
const POISON_COST = 30;    // worker-seconds a broken image burns before the job times out
const BULK_AT = 60;        // the bulk import arrives at this second
const POISON_AT = 120;     // broken images arrive at this second, among the live uploads
const MAX_TRIES = 3;       // with backoff, a job that failed this often goes to the dead-letter queue
const BACKOFF = 10;        // first retry waits this long, then doubles
const MIN_W = 30, MAX_W = 400, BOOT = 60, SCALE_EVERY = 30, DRAIN = 120; // autoscaler

function run(name, { lanes, workers, bulk, poison, backoff, autoscale }) {
  const live = [], batch = [], waiting = [], pending = [];
  const lat = new Map(); // seconds from upload to done -> photos
  let w = workers, budget = 0, bulkDone = 0, bulkEnd = -1, burned = 0, dlq = 0, workerSeconds = 0;
  const laneOf = (kind) => (lanes && kind === 'bulk' ? batch : live);
  const cost = (b) => (b.kind === 'poison' ? POISON_COST : COST);
  for (let t = 0; t < END; t++) {
    live.push({ t, kind: 'live', n: LIVE_PER_S, tries: 0 });
    if (t === BULK_AT && bulk) laneOf('bulk').push({ t, kind: 'bulk', n: bulk, tries: 0 });
    if (t === POISON_AT) for (let i = 0; i < poison; i++) live.push({ t, kind: 'poison', n: 1, tries: 0 });
    for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].ready <= t) { live.push(waiting[i].b); waiting.splice(i, 1); }
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i][0] <= t) { w += pending[i][1]; pending.splice(i, 1); }
    if (autoscale && t % SCALE_EVERY === 0) {
      let backlog = 0;
      for (const b of [...live, ...batch]) backlog += b.n * cost(b);
      const target = Math.min(MAX_W, MIN_W + Math.floor((backlog + DRAIN - 1) / DRAIN));
      const planned = w + pending.reduce((s, p) => s + p[1], 0);
      if (target > planned) pending.push([t + BOOT, target - planned]);
      else if (target < w && pending.length === 0) w = target;
    }
    workerSeconds += w;
    budget += w;
    for (const q of [live, batch]) {
      while (q.length && budget >= cost(q[0])) {
        const b = q[0], c = cost(b), k = Math.min(b.n, Math.floor(budget / c));
        budget -= k * c; b.n -= k;
        if (b.kind === 'live') { const d = t - b.t + COST; lat.set(d, (lat.get(d) ?? 0) + k); } // waited, then 2 s of work
        if (b.kind === 'bulk') { bulkDone += k; if (bulkDone === bulk) bulkEnd = t; }
        if (b.kind === 'poison') {
          burned += c;
          b.tries++;
          if (!backoff) waiting.push({ ready: t + POISON_COST, b: { ...b, n: 1 } }); // back on the queue the moment the worker gives up, for ever
          else if (b.tries >= MAX_TRIES) dlq++;                   // give up: a person looks at it
          else waiting.push({ ready: t + POISON_COST + BACKOFF * 2 ** (b.tries - 1), b: { ...b, n: 1 } }); // after the failed run, then the delay
        }
        if (b.n === 0) q.shift();
      }
    }
    if (!live.length && !batch.length) budget = 0; // idle time cannot be saved up
  }
  const total = LIVE_PER_S * END;
  let seen = 0, p95 = -1, fast = 0;
  for (const s of [...lat.keys()].sort((a, b) => a - b)) {
    seen += lat.get(s);
    if (s <= 10) fast = seen;
    if (p95 < 0 && seen * 100 >= total * 95) p95 = s;
  }
  console.log(`-- ${name}`);
  console.log(`  live photos: p95 ${p95 < 0 ? 'over 20 min' : `${p95}s`}, ${Math.floor((fast * 100) / total)}% within 10s`);
  console.log(`  bulk import: ${bulk ? (bulkEnd < 0 ? `${bulkDone} of ${bulk} done` : `done at ${bulkEnd}s`) : 'none'}; broken images burned ${burned} worker-seconds, ${dlq} in the dead-letter queue`);
  console.log(`  ${w} workers at the end, ${Math.floor(workerSeconds / 3600)} worker-hours used`);
  if (bulkDone > bulk || fast > total) throw new Error('impossible count');
}

const base = { lanes: false, workers: 30, bulk: 100000, poison: 0, backoff: false, autoscale: false };
run('one queue, 30 workers', base);
run('separate lanes', { ...base, lanes: true });
run('separate lanes, autoscaled', { ...base, lanes: true, autoscale: true });
run('separate lanes, 20 broken images retried at once', { ...base, lanes: true, poison: 20 });
run('separate lanes, 20 broken images, backoff and a dead-letter queue', { ...base, lanes: true, poison: 20, backoff: true });
run('separate lanes, autoscaled, 20 broken images retried at once', { ...base, lanes: true, autoscale: true, poison: 20 });
