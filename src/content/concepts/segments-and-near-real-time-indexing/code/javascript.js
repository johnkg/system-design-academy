// Near-real-time indexing: documents wait in a memory buffer, a refresh turns the buffer into a new immutable segment
// that searches can see, and a merge policy combines similar-sized segments into bigger ones. Two minutes, in 100 ms ticks.
// Everything is integers and fixed events, so the output never changes.
const TICK_MS = 100;
const END_MS = 120000;       // 2 minutes simulated
const UPDATE_EVERY = 10;     // every 10th new document replaces an older one: the old copy is only marked deleted

// docsPerSec: arrivals (a multiple of 10); refreshMs: a multiple of 100; mergeAt: segments of one level that trigger a merge (0 = never merge)
function run(docsPerSec, refreshMs, mergeAt) {
  const perTick = docsPerSec * TICK_MS / 1000;
  const segments = [];       // { level, docs, dead }: docs counts every document stored, dead those marked deleted
  let buffer = 0, arrived = 0, flushed = 0, mergeWritten = 0, merges = 0, created = 0;
  let delaySum = 0, delayMax = 0, peak = 0, segTicks = 0, ticks = 0, pendingDelay = 0;
  const pending = [];        // arrival time (middle of the tick) of each tick's batch that is not yet searchable

  for (let t = TICK_MS; t <= END_MS; t += TICK_MS) {
    buffer += perTick;
    pending.push(t - TICK_MS / 2);
    for (let i = 0; i < perTick; i++) {
      arrived++;
      if (arrived % UPDATE_EVERY === 0) {
        const old = segments.find((s) => s.docs - s.dead > 0);
        if (old) old.dead++;   // a delete is a mark, the document stays on disk until a merge rewrites the segment
      }
    }
    if (t % refreshMs === 0 && buffer > 0) {
      segments.push({ level: 0, docs: buffer, dead: 0 });
      created++; flushed += buffer; buffer = 0;
      for (const at of pending) { const d = t - at; delaySum += d * perTick; if (d > delayMax) delayMax = d; }
      pending.length = 0;
      while (mergeAt > 0) {
        let level = -1;
        for (let l = 0; l < 20 && level < 0; l++) if (segments.filter((s) => s.level === l).length >= mergeAt) level = l;
        if (level < 0) break;
        const group = segments.filter((s) => s.level === level).slice(0, mergeAt);
        const live = group.reduce((n, s) => n + s.docs - s.dead, 0);
        for (const s of group) segments.splice(segments.indexOf(s), 1);
        segments.push({ level: level + 1, docs: live, dead: 0 });
        mergeWritten += live; merges++;
      }
    }
    peak = Math.max(peak, segments.length);
    segTicks += segments.length; ticks++;
  }
  const onDisk = segments.reduce((n, s) => n + s.docs, 0);
  const dead = segments.reduce((n, s) => n + s.dead, 0);
  const delayAvg = Math.floor(delaySum / flushed);
  return { arrived, created, merges, peak, final: segments.length, avgSegs: Math.floor(segTicks / ticks), delayAvg, delayMax,
    ampX100: Math.floor((flushed + mergeWritten) * 100 / flushed), written: flushed + mergeWritten, onDisk, dead };
}

const show = (name, r) => {
  console.log(`-- ${name}`);
  console.log(`  searchable after ${r.delayAvg} ms on average, ${r.delayMax} ms at worst`);
  console.log(`  segments: ${r.created} created, ${r.merges} merges, peak ${r.peak}, ${r.final} at the end (a query visits every one)`);
  console.log(`  disk writes: ${r.written} documents for ${r.arrived} arrived (write amplification x100 = ${r.ampX100}); ${r.dead} deleted copies still on disk`);
};
const cases = [
  ['500 docs/s, refresh 1 s, merge at 10 similar segments', run(500, 1000, 10)],
  ['500 docs/s, refresh 100 ms, never merge', run(500, 100, 0)],
  ['500 docs/s, refresh 100 ms, merge at 10 similar segments', run(500, 100, 10)],
  ['500 docs/s, refresh 30 s, merge at 10 similar segments', run(500, 30000, 10)],
  ['500 docs/s, refresh 1 s, merge at 4 similar segments', run(500, 1000, 4)],
];
for (const [name, r] of cases) show(name, r);
if (cases[1][1].peak <= cases[2][1].peak * 10 || cases[3][1].delayAvg <= cases[0][1].delayAvg) throw new Error('impossible result');
