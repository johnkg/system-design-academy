// A replicated key-value store with tunable quorums in JavaScript:
// keys are placed on a hash ring, each key lives on N nodes, a write waits for W of them and a read asks R of them.

const N = 3; // copies of every key

function hash(text) { // FNV-1a: a small, fast, well-spread hash
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

class Ring {
  constructor(names, tokensPerNode = 16) {
    this.tokens = names.flatMap((name) => Array.from({ length: tokensPerNode }, (_, i) => ({ at: hash(`${name}#${i}`), name })));
    this.tokens.sort((a, b) => a.at - b.at);
  }
  // Walk clockwise from the key's position and collect the first N different nodes.
  preferenceList(key) {
    const h = hash(key);
    let i = this.tokens.findIndex((t) => t.at >= h);
    if (i < 0) i = 0;
    const out = [];
    for (let step = 0; step < this.tokens.length && out.length < N; step++) {
      const name = this.tokens[(i + step) % this.tokens.length].name;
      if (!out.includes(name)) out.push(name);
    }
    return out;
  }
}

class Cluster {
  constructor(names) {
    this.ring = new Ring(names);
    this.nodes = new Map(names.map((n) => [n, { up: true, data: new Map() }]));
    this.clock = 0; // a version number that only grows (real systems use vector clocks or timestamps)
  }

  put(key, value, W) {
    const version = ++this.clock;
    let acks = 0;
    for (const name of this.ring.preferenceList(key)) {
      const node = this.nodes.get(name);
      if (!node.up) continue; // a node that is down simply misses this write
      node.data.set(key, { value, version });
      acks++;
    }
    if (acks < W) throw new Error(`only ${acks} of the ${W} required replicas answered`);
    return version;
  }

  // Ask the given replicas and return the newest answer, without changing anything.
  read(key, ask) {
    const answers = ask.map((n) => ({ n, entry: this.nodes.get(n).data.get(key) }));
    const newest = answers.reduce((a, b) => ((b.entry?.version ?? 0) > (a.entry?.version ?? 0) ? b : a)).entry;
    return { answers, newest };
  }

  // Ask R replicas (the first R that are up) and return the newest answer, then fix any replica that answered with old data.
  get(key, R) {
    const ask = this.ring.preferenceList(key).filter((n) => this.nodes.get(n).up).slice(0, R);
    if (ask.length < R) throw new Error('not enough replicas are up');
    const { answers, newest } = this.read(key, ask);
    if (newest) answers.filter((a) => (a.entry?.version ?? 0) < newest.version).forEach((a) => this.nodes.get(a.n).data.set(key, newest)); // read repair
    return newest?.value;
  }
}

function pairs(list, r) { // every way of choosing r replicas to ask
  if (r === 1) return list.map((x) => [x]);
  return list.flatMap((x, i) => pairs(list.slice(i + 1), r - 1).map((rest) => [x, ...rest]));
}

function run(W, R) {
  const cluster = new Cluster(['A', 'B', 'C', 'D', 'E']);
  const key = 'user:42';
  const replicas = cluster.ring.preferenceList(key);
  cluster.put(key, 'old', N); // everything is in sync
  cluster.nodes.get(replicas[2]).up = false; // one replica goes down...
  try { cluster.put(key, 'new', W); } catch (e) { return { replicas, rejected: e.message }; } // ...and misses this write; asking for W=3 then fails
  cluster.nodes.get(replicas[2]).up = true; // it comes back, still holding the old value
  const stale = pairs(replicas, R).filter((ask) => cluster.read(key, ask).newest?.value !== 'new').length; // try every choice of replicas to ask
  return { replicas, stale, total: pairs(replicas, R).length };
}

let wrong = 0;
for (const [W, R] of [[2, 2], [3, 1], [1, 1]]) {
  const { replicas, stale, total, rejected } = run(W, R);
  const strong = W + R > N;
  const label = `N=${N} W=${W} R=${R} (${strong ? 'W+R>N' : 'W+R<=N'})  replicas ${replicas.join(',')}`;
  if (rejected) { console.log(`${label}  write rejected while one replica is down: ${rejected}`); if (W < N) wrong++; continue; }
  console.log(`${label}  stale reads: ${stale} of ${total} possible choices`);
  if (strong && stale > 0) wrong++;      // overlapping quorums must never return old data
  if (!strong && stale === 0) wrong++;   // and without overlap, stale data must be possible
}
if (wrong) process.exit(1);
