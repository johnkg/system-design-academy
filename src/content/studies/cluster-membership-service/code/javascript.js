// SWIM-style membership in JavaScript: random probes, indirect probes, a suspicion state, incarnation numbers,
// updates piggybacked on the probe messages, and a consistent-hash ring that reacts to the verdicts.

const N = 12, CRASH = 3, SLOW = 7, CRASH_AT = 5, PAUSE_AT = 20, PAUSE_FOR = 4, ROUNDS = 40;
const RETRANSMIT = 8, PIGGYBACK = 4, LOSS = 5; // each update is sent 8 times, 4 per message, 5% of messages are lost
const ALIVE = 0, SUSPECT = 1, DEAD = 2;

let seed = 7;
const rand = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };
const running = (x, t) => !(x === CRASH && t >= CRASH_AT) && !(x === SLOW && t >= PAUSE_AT && t < PAUSE_AT + PAUSE_FOR);

function run(suspectFor) {
  seed = 7;
  const nodes = Array.from({ length: N }, (_, id) => ({ id, inc: 0, refute: false, status: Array(N).fill(ALIVE), known: Array(N).fill(0), since: Array(N).fill(0), buffer: [] }));
  const everDead = new Set();
  let learnedAt = -1;

  const queue = (node, who, status, inc) => {
    node.buffer = node.buffer.filter((u) => u.who !== who);
    node.buffer.push({ who, status, inc, left: RETRANSMIT });
  };
  const apply = (node, u, t) => {
    if (u.who === node.id) { if (u.status !== ALIVE && u.inc >= node.inc) node.refute = true; return; } // someone doubts me
    const w = u.who;
    const fresh = u.status === ALIVE ? u.inc > node.known[w]
      : u.status === SUSPECT ? node.status[w] !== DEAD && (u.inc > node.known[w] || (u.inc === node.known[w] && node.status[w] === ALIVE))
      : node.status[w] !== DEAD && u.inc >= node.known[w];
    if (!fresh) return;
    node.status[w] = u.status; node.known[w] = u.inc; node.since[w] = t;
    if (u.status === DEAD && w !== CRASH) everDead.add(w);
    queue(node, w, u.status, u.inc);
  };
  const send = (from, to, t) => { // one message with piggybacked updates; false if it was lost
    const items = nodes[from].buffer.sort((a, b) => b.left - a.left || a.who - b.who).slice(0, PIGGYBACK);
    items.forEach((u) => u.left--);
    nodes[from].buffer = nodes[from].buffer.filter((u) => u.left > 0);
    if (rand(100) < LOSS) return false;
    items.forEach((u) => apply(nodes[to], u, t));
    return true;
  };

  for (let t = 0; t < ROUNDS; t++) {
    for (const node of nodes) {
      if (!running(node.id, t)) continue;
      if (node.refute) { node.refute = false; node.inc++; queue(node, node.id, ALIVE, node.inc); } // refute with a higher incarnation
      const others = nodes.filter((n) => n.id !== node.id && node.status[n.id] !== DEAD).map((n) => n.id);
      const target = others[rand(others.length)];
      let ok = send(node.id, target, t) && running(target, t) && send(target, node.id, t);
      if (!ok) { // indirect probes through two other nodes
        const helpers = others.filter((x) => x !== target);
        for (let k = 0; k < 2 && helpers.length > 0; k++) {
          const m = helpers.splice(rand(helpers.length), 1)[0];
          if (send(node.id, m, t) && running(m, t) && send(m, target, t) && running(target, t) && send(target, m, t) && send(m, node.id, t)) ok = true;
        }
      }
      if (!ok) apply(node, { who: target, status: SUSPECT, inc: node.known[target] }, t);
      for (let j = 0; j < N; j++) if (node.status[j] === SUSPECT && t - node.since[j] >= suspectFor) apply(node, { who: j, status: DEAD, inc: node.known[j] }, t);
    }
    if (learnedAt < 0 && t >= CRASH_AT && nodes.every((n) => n.id === CRASH || n.status[CRASH] === DEAD)) learnedAt = t - CRASH_AT;
  }
  return { learnedAt, falseDead: [...everDead].sort((a, b) => a - b), incSlow: nodes[SLOW].inc };
}

const mix = (x) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
function owner(key, members) { // first token at or after the key's hash, going clockwise
  const h = mix(key * 31 + 5); let best = -1, bestTok = 0, first = -1, firstTok = 0;
  for (const m of members) for (let v = 0; v < 8; v++) {
    const tok = mix(m * 100 + v);
    if (tok >= h && (best < 0 || tok < bestTok)) { best = m; bestTok = tok; }
    if (first < 0 || tok < firstTok) { first = m; firstTok = tok; }
  }
  return best >= 0 ? best : first;
}

for (const suspectFor of [6, 2]) {
  const r = run(suspectFor);
  console.log(`suspicion ${suspectFor}: crash known by every node ${r.learnedAt} rounds after it happened; healthy nodes declared dead: [${r.falseDead.join(',')}]; slow node incarnation ${r.incSlow}`);
  if (r.learnedAt < 0) process.exit(1);
  if (suspectFor === 6 && (r.falseDead.length !== 0 || r.incSlow < 1)) process.exit(1); // the pause is shorter than the suspicion time, so it is refuted
  if (suspectFor === 2 && !r.falseDead.includes(SLOW)) process.exit(1);                 // a too-short suspicion time causes a false positive
}

const all = Array.from({ length: N }, (_, i) => i), without = (x) => all.filter((m) => m !== x);
const keys = Array.from({ length: 1000 }, (_, k) => k);
const before = keys.map((k) => owner(k, all));
const moved = (gone) => keys.filter((k) => owner(k, without(gone)) !== before[k]).length;
const owned = (x) => before.filter((o) => o === x).length;
console.log(`ring: removing node ${CRASH} moves ${moved(CRASH)} of 1000 keys, exactly the ${owned(CRASH)} it owned`);
console.log(`ring: a false alarm on node ${SLOW} moves ${moved(SLOW)} keys out and ${moved(SLOW)} back`);
if (moved(CRASH) !== owned(CRASH) || moved(SLOW) !== owned(SLOW) || owned(CRASH) === 0) process.exit(1);
