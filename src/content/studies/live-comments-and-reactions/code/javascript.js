// Live comments and reactions, in JavaScript:
// edge nodes count reactions and keep only their best few comments each second, and a root merges the small summaries.

const EDGES = 8, SECONDS = 5, KEEP = 4, TYPES = 4;
const FLAG_ONE_IN = 11; // every 11th comment is flagged by moderation
const TYPE_SCALE = 10; // reaction mix out of 10: heart 5, laugh 3, clap 1, wow 1
const HEART_UPTO = 5;
const LAUGH_UPTO = 8;
const CLAP_UPTO = 9;
const REACTIONS_MIN = 200; // per edge per second: 200..299 reactions, 20..29 comments
const REACTIONS_SPREAD = 100;
const COMMENTS_MIN = 20;
const COMMENTS_SPREAD = 10;
const NAMES = ['heart', 'laugh', 'clap', 'wow'];

let seed = 7;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };

// A fixed hash gives every comment the same priority on every node, so sampling needs no coordination.
const priority = (id) => {
  let x = Math.imul(id ^ (id >>> 16), 2246822519) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};
const flagged = (id) => id % FLAG_ONE_IN === 0; // stands in for the moderation verdict
const byPriority = (a, b) => b.pri - a.pri || a.id - b.id;

class Edge {
  constructor() { this.counts = new Array(TYPES).fill(0); this.best = []; this.dropped = 0; }
  react(type) { this.counts[type]++; }
  comment(id) {
    if (flagged(id)) { this.dropped++; return; }          // moderation happens before anything is published
    this.best.push({ id, pri: priority(id) });
    this.best.sort(byPriority);
    this.best.length = Math.min(this.best.length, KEEP);  // memory stays at KEEP comments, however many arrive
  }
  flush() { const out = { counts: this.counts, best: this.best, dropped: this.dropped }; Object.assign(this, new Edge()); return out; }
}

const pickType = () => { const r = rnd(TYPE_SCALE); return r < HEART_UPTO ? 0 : r < LAUGH_UPTO ? 1 : r < CLAP_UPTO ? 2 : 3; };

const total = new Array(TYPES).fill(0), truthTotal = new Array(TYPES).fill(0);
let nextId = 0, eventsIn = 0, messagesOut = 0, accepted = 0, shownCount = 0, ok = true;
for (let s = 0; s < SECONDS; s++) {
  const edges = Array.from({ length: EDGES }, () => new Edge());
  const everything = []; // the slow, obvious record of every accepted comment, to check against
  for (const edge of edges) {
    const reactions = REACTIONS_MIN + rnd(REACTIONS_SPREAD), comments = COMMENTS_MIN + rnd(COMMENTS_SPREAD);
    for (let i = 0; i < reactions; i++) { const t = pickType(); edge.react(t); truthTotal[t]++; }
    for (let i = 0; i < comments; i++) { const id = ++nextId; edge.comment(id); if (!flagged(id)) everything.push({ id, pri: priority(id) }); }
    eventsIn += reactions + comments;
  }
  const summaries = edges.map((e) => e.flush());
  const second = new Array(TYPES).fill(0);
  summaries.forEach((m) => m.counts.forEach((c, t) => { second[t] += c; total[t] += c; }));
  const shown = summaries.flatMap((m) => m.best).sort(byPriority).slice(0, KEEP); // merging top lists is exact
  const expected = everything.sort(byPriority).slice(0, KEEP);
  accepted += everything.length; shownCount += shown.length;
  const same = JSON.stringify(shown) === JSON.stringify(expected);
  ok = ok && same;
  messagesOut += 1; // one message per second to every viewer carries the tally and the sampled comments
  const dropped = summaries.reduce((a, m) => a + m.dropped, 0);
  console.log(`t=${s} reactions=[${second.join(',')}] shown=[${shown.map((c) => c.id).join(',')}] blocked=${dropped} exact=${same}`);
}
const sumOk = total.every((c, t) => c === truthTotal[t]);
console.log(`totals: ${NAMES.map((n, t) => `${n}=${total[t]}`).join(' ')} match=${sumOk}`);
console.log(`events in: ${eventsIn}, messages out per viewer: ${messagesOut}, reduction: ${Math.floor(eventsIn / messagesOut)}x`);
// Every viewer sees only the sampled comments, so the stream a phone must read is small and the same for everyone.
const tenths = Math.floor((shownCount * 1000) / accepted);
console.log(`comments accepted: ${accepted}, shown to viewers: ${shownCount}, share shown: ${Math.floor(tenths / 10)}.${tenths % 10}%`);
if (!ok || !sumOk) process.exit(1);
