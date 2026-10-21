// A live stream through a CDN, in JavaScript:
// a rendition ladder, segment requests through edge and shield caches, glass-to-glass latency and an ingest failover.

const LADDER = [['1080p', 6000], ['720p', 3000], ['480p', 1200], ['240p', 400]]; // name and kbit/s
const SHARE = [20, 40, 30, 10]; // percent of viewers who settle on each rendition
const SEG_MS = 2000, SEGS = 30, EDGES = 8, VIEWERS = 2000;
const MS_PER_SECOND = 1000, PER_VIEWERS = 1000; // request rates are quoted per 1000 viewers
const INGEST_MS = 300, TRANSCODE_MS = 500, DELIVERY_MS = 400;
// Failover demo: the stream dies at 25.3 s; a cold standby needs 2 s to notice and 3 s to start, a warm one 1 s and none.
const FAIL_AT = 25300, COLD_DETECT_MS = 2000, COLD_START_MS = 3000, WARM_DETECT_MS = 1000;

const SEED = 7;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };

const viewers = Array.from({ length: VIEWERS }, () => {
  let pick = rnd(100), r = 0;
  while (pick >= SHARE[r]) { pick -= SHARE[r]; r++; }
  return { rendition: r, edge: rnd(EDGES) };
});

// Every viewer asks its edge for every segment. A miss goes to the shield (if there is one) and then to the origin.
// Requests for a key that is already cached, or already on its way, are coalesced and do not go further.
function deliver(useShield) {
  const edgeSeen = new Set(), shieldSeen = new Set();
  const out = { fromEdges: 0, origin: 0, originKbit: 0 };
  for (let seg = 0; seg < SEGS; seg++) {
    for (const v of viewers) {
      if (edgeSeen.has(`${v.edge}:${v.rendition}:${seg}`)) continue;
      edgeSeen.add(`${v.edge}:${v.rendition}:${seg}`);
      out.fromEdges++;
      const key = `${v.rendition}:${seg}`;
      if (useShield && shieldSeen.has(key)) continue;
      shieldSeen.add(key);
      out.origin++;
      out.originKbit += LADDER[v.rendition][1] * (SEG_MS / MS_PER_SECOND);
    }
  }
  return out;
}

// Delay from camera to screen: ingest, transcode, wait for a whole unit (segment or part), the player's hold-back, delivery.
const glassToGlass = (unitMs, held) => INGEST_MS + TRANSCODE_MS + unitMs + held * unitMs + DELIVERY_MS;

// The stream dies at failAt. The standby takes over at the next segment boundary after it has noticed and started.
function failover(failAt, detectMs, startMs) {
  const lastGood = Math.floor(failAt / SEG_MS) * SEG_MS;
  const resume = Math.ceil((failAt + detectMs + startMs) / SEG_MS) * SEG_MS;
  return resume - lastGood; // milliseconds of stream with no segments
}

console.log(`ladder: ${LADDER.map(([n, k]) => `${n}=${k}`).join(' ')} total ${LADDER.reduce((s, [, k]) => s + k, 0)} kbit/s`);
const plain = deliver(false), shielded = deliver(true);
console.log(`requests to origin over ${SEGS} segments: ${plain.origin} without shield, ${shielded.origin} with shield`);
console.log(`origin egress: ${plain.originKbit} kbit without shield, ${shielded.originKbit} with shield`);
for (const [name, unit, held] of [['6 s segments, hold 3', 6000, 3], ['2 s segments, hold 3', 2000, 3], ['2 s segments, hold 2', 2000, 2], ['0.5 s parts, hold 3', 500, 3]]) {
  console.log(`${name}: ${glassToGlass(unit, held)} ms, ${Math.floor((PER_VIEWERS * MS_PER_SECOND) / unit)} requests/s per 1000 viewers`);
}
const cold = failover(FAIL_AT, COLD_DETECT_MS, COLD_START_MS), warm = failover(FAIL_AT, WARM_DETECT_MS, 0);
const stalls = (gap, held) => (gap > held * SEG_MS ? 'stalls' : 'plays on');
console.log(`failover gap: cold standby ${cold} ms, warm standby ${warm} ms, dual active 0 ms`);
console.log(`viewer holding 1 segment: cold ${stalls(cold, 1)}, warm ${stalls(warm, 1)}; holding 3: cold ${stalls(cold, 3)}, warm ${stalls(warm, 3)}`);

const floor = LADDER.length * SEGS;
if (shielded.origin !== floor) process.exit(1);             // one fetch per rendition and segment
if (plain.origin <= shielded.origin * 4) process.exit(2);   // without a shield every edge fetches on its own
if (glassToGlass(500, 3) >= glassToGlass(2000, 2)) process.exit(3);
if (warm >= cold) process.exit(4);
