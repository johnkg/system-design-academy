// Union-find (disjoint sets) with and without path compression and union by rank, counting operations, not time.
// One operation = one read or write of a parent pointer (following a pointer, linking two roots, or rewriting a pointer during compression).
// Look for: the chain workload makes plain union-find quadratic (every query walks the whole chain) while
// compression or rank (or both) keep it near one step per operation; random edges are kind to everything;
// a graph traversal wins when the graph is fixed (one pass labels every component) but must be re-run after
// every new edge when edges keep arriving, which is where union-find earns its place.

const M = 2147483647; // Park-Miller generator: small enough that a * 48271 fits in 53 bits, so all languages agree

class Rng {
  constructor(seed) { this.s = seed; }
  next() { this.s = (this.s * 48271) % M; return this.s; }
}

class DSU {
  constructor(n, rank, compress) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
    this.useRank = rank;
    this.useCompress = compress;
    this.ops = 0;
  }

  find(x) {
    let r = x;
    while (this.parent[r] !== r) {
      r = this.parent[r];
      this.ops++;
    }
    if (this.useCompress) {
      while (this.parent[x] !== r) { // second pass: point every node on the path straight at the root
        const nxt = this.parent[x];
        this.parent[x] = r;
        this.ops++;
        x = nxt;
      }
    }
    return r;
  }

  union(a, b) {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    if (this.useRank && this.rank[ra] > this.rank[rb]) [ra, rb] = [rb, ra]; // attach the shallower root under the deeper one
    this.parent[ra] = rb;
    this.ops++;
    if (this.useRank && this.rank[ra] === this.rank[rb]) this.rank[rb]++;
    return true;
  }

  depth() {
    let best = 0;
    for (let i = 0; i < this.parent.length; i++) {
      let x = i, d = 0;
      while (this.parent[x] !== x) { x = this.parent[x]; d++; }
      best = Math.max(best, d);
    }
    return best;
  }
}

const VARIANTS = [["naive", false, false], ["rank", true, false], ["compression", false, true], ["both", true, true]];

function randomWorkload(n, seed = 12345) {
  const rng = new Rng(seed);
  const edges = [], queries = [];
  for (let i = 0; i < n; i++) { const a = rng.next() % n; const b = rng.next() % n; edges.push([a, b]); }
  for (let i = 0; i < n; i++) { const a = rng.next() % n; const b = rng.next() % n; queries.push([a, b]); }
  return { edges, queries };
}

// Traversal on a fixed graph: build adjacency, then one pass labels every component; each query is a label comparison.
function traversalStatic(n, edges, queries) {
  let ops = 0;
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); ops++; }
  const label = new Array(n).fill(-1);
  let comps = 0;
  for (let s = 0; s < n; s++) {
    ops++;
    if (label[s] >= 0) continue;
    label[s] = comps;
    const stack = [s];
    while (stack.length) {
      const x = stack.pop();
      for (const y of adj[x]) {
        ops++;
        if (label[y] < 0) { label[y] = comps; stack.push(y); }
      }
    }
    comps++;
  }
  let answers = 0;
  for (const [a, b] of queries) { ops++; if (label[a] === label[b]) answers++; }
  return { ops, comps, answers };
}

function runRandom(n) {
  const { edges, queries } = randomWorkload(n);
  const out = {};
  for (const [name, rank, comp] of VARIANTS) {
    const d = new DSU(n, rank, comp);
    for (const [a, b] of edges) d.union(a, b);
    const builtDepth = d.depth();
    let answers = 0;
    for (const [a, b] of queries) if (d.find(a) === d.find(b)) answers++;
    let comps = 0;
    for (let x = 0; x < n; x++) if (d.parent[x] === x) comps++;
    out[name] = { ops: d.ops, comps, answers, depth: builtDepth };
  }
  return { dsu: out, trav: traversalStatic(n, edges, queries) };
}

// Chain workload: edge i joins element i and i+1; after every edge ask "is element 0 connected to the newest element?".
function runChain(n) {
  const out = {};
  for (const [name, rank, comp] of VARIANTS) {
    const d = new DSU(n, rank, comp);
    let yes = 0;
    for (let i = 0; i < n - 1; i++) {
      d.union(i, i + 1);
      if (d.find(0) === d.find(i + 1)) yes++;
    }
    out[name] = { ops: d.ops, yes };
  }
  // Traversal has no way to add an edge to an answer already computed: after each edge it searches again from element 0.
  let ops = 0, yes = 0;
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n - 1; i++) {
    adj[i].push(i + 1);
    adj[i + 1].push(i);
    ops++;
    const seen = new Array(n).fill(false);
    seen[0] = true;
    const stack = [0];
    let found = false;
    while (stack.length && !found) {
      const x = stack.pop();
      ops++;
      if (x === i + 1) { found = true; break; }
      for (const y of adj[x]) {
        ops++;
        if (!seen[y]) { seen[y] = true; stack.push(y); }
      }
    }
    if (found) yes++;
  }
  out.traversal = { ops, yes };
  return out;
}

console.log("-- random edges: n edges, then n connectivity queries (pointer operations)");
for (const n of [10, 100, 1000]) {
  const { dsu, trav } = runRandom(n);
  console.log(`  n=${n}: naive ${dsu.naive.ops}, rank ${dsu.rank.ops}, compression ${dsu.compression.ops}, both ${dsu.both.ops}, ` +
    `one traversal pass ${trav.ops}; components ${dsu.both.comps} (traversal ${trav.comps}), connected answers ${dsu.both.answers} (traversal ${trav.answers})`);
}
console.log("-- deepest path from any element to its root after the random edges (before any query compresses it)");
for (const n of [10, 100, 1000]) {
  const { dsu } = runRandom(n);
  console.log(`  n=${n}: naive ${dsu.naive.depth}, rank ${dsu.rank.depth}`);
}
console.log('-- chain: edge i joins i and i+1, then ask whether 0 is connected to the newest element, after every edge');
for (const n of [10, 100, 1000]) {
  const r = runChain(n);
  const allYes = Object.values(r).every((v) => v.yes === n - 1);
  console.log(`  n=${n}: naive ${r.naive.ops}, rank ${r.rank.ops}, compression ${r.compression.ops}, both ${r.both.ops}, ` +
    `traversal re-run after every edge ${r.traversal.ops}; every answer yes: ${allYes ? "True" : "False"}`);
}
