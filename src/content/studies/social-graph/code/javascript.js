// A sharded friend graph in JavaScript:
// sorted adjacency lists, mutual friends by merging two lists, friend-of-friend with a cap on hubs, and bidirectional search.

const USERS = 500, SHARDS = 4, HUB_CAP = 100;
const shardOf = (u) => u % SHARDS; // the shard that owns user u's list
const adj = Array.from({ length: USERS }, () => []); // each list stays sorted

// First index whose value is >= x (binary search, so a list of millions is still fast).
const lower = (list, x) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < x) lo = m + 1; else hi = m; } return lo; };
const isFriend = (a, b) => adj[a][lower(adj[a], b)] === b;

let edges = 0, crossShard = 0;
function connect(a, b) { // a friendship is stored twice, once in each person's list, and these may be on two shards
  if (a === b || isFriend(a, b)) return;
  adj[a].splice(lower(adj[a], b), 0, b); adj[b].splice(lower(adj[b], a), 0, a);
  edges++; if (shardOf(a) !== shardOf(b)) crossShard++;
}

// Mutual friends: walk two sorted lists together. The cost is the sum of their lengths at most.
function mutual(a, b) {
  const x = adj[a], y = adj[b], common = []; let i = 0, j = 0, steps = 0;
  while (i < x.length && j < y.length) { steps++; if (x[i] === y[j]) { common.push(x[i]); i++; j++; } else if (x[i] < y[j]) i++; else j++; }
  return { common, steps };
}

// Friend-of-friend: count how many friends each stranger shares with u. Friends with more than `cap` friends are skipped.
function suggest(u, cap) {
  const count = new Map(); let touched = 0; const shards = new Set();
  for (const f of adj[u]) {
    if (adj[f].length > cap) continue; // a hub would add thousands of weak candidates
    shards.add(shardOf(f));
    for (const g of adj[f]) { touched++; if (g !== u && !isFriend(u, g)) count.set(g, (count.get(g) || 0) + 1); }
  }
  const ranked = [...count].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  return { ranked, touched, shards: shards.size };
}

// Degrees of separation by plain breadth-first search, and by searching from both ends and meeting in the middle.
function bfs(a, b) {
  const dist = new Map([[a, 0]]); let queue = [a], scanned = 0;
  while (queue.length && !dist.has(b)) {
    const next = [];
    for (const u of queue) for (const v of adj[u]) { scanned++; if (!dist.has(v)) { dist.set(v, dist.get(u) + 1); next.push(v); } }
    queue = next;
  }
  return { dist: dist.get(b), scanned };
}
function bidirectional(a, b) {
  if (a === b) return { dist: 0, scanned: 0 };
  const seen = [new Map([[a, 0]]), new Map([[b, 0]])], front = [[a], [b]]; let scanned = 0;
  while (front[0].length && front[1].length) {
    const s = front[0].length <= front[1].length ? 0 : 1; // always grow the smaller side
    const mine = seen[s], other = seen[1 - s], next = []; let best = Infinity;
    for (const u of front[s]) for (const v of adj[u]) {
      scanned++;
      if (other.has(v)) best = Math.min(best, mine.get(u) + 1 + other.get(v));
      if (!mine.has(v)) { mine.set(v, mine.get(u) + 1); next.push(v); }
    }
    if (best < Infinity) return { dist: best, scanned };
    front[s] = next;
  }
  return { dist: -1, scanned };
}

let seed = 7; // a small deterministic generator, so every run builds the same graph
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 65536) % n; };
for (let u = 3; u < USERS; u++) // users 0, 1 and 2 are celebrities that 3 in 10 friendships point to
  for (let i = 0; i < 6; i++) connect(u, rnd(10) < 3 ? rnd(3) : (u + 1 + rnd(25)) % USERS);

const degrees = adj.map((l) => l.length), maxDegree = Math.max(...degrees);
console.log(`${USERS} users, ${edges} friendships, ${crossShard} of them across shards, biggest list ${maxDegree}, typical list ${degrees[250]}`);

const m = mutual(250, 262);
console.log(`mutual friends of 250 and 262: [${m.common.join(', ')}] after ${m.steps} steps (lists of ${adj[250].length} and ${adj[262].length})`);

const noCap = suggest(250, Infinity), capped = suggest(250, HUB_CAP);
const show = (r) => r.ranked.slice(0, 3).map(([id, c]) => `${id}x${c}`).join(' ');
console.log(`suggestions for 250 without a cap: ${show(noCap)}, edges read ${noCap.touched}, shards ${noCap.shards}`);
console.log(`suggestions for 250 with cap ${HUB_CAP}: ${show(capped)}, edges read ${capped.touched}, shards ${capped.shards}`);

let pairs = 0, sumPlain = 0, sumBoth = 0;
for (let i = 0; i < 200; i++) {
  const a = (i * 37) % USERS, b = (i * 91 + 5) % USERS, p = bfs(a, b), q = bidirectional(a, b);
  if (p.dist !== q.dist || p.dist < 0) { console.log(`mismatch for ${a} and ${b}`); process.exit(1); }
  pairs++; sumPlain += p.scanned; sumBoth += q.scanned;
}
console.log(`${pairs} distance queries agree; edges scanned: plain ${sumPlain}, bidirectional ${sumBoth}`);

const symmetric = adj.every((l, a) => l.every((b) => isFriend(b, a))) && adj.every((l) => l.every((v, i) => i === 0 || l[i - 1] < v));
const mutualOk = m.common.every((c) => isFriend(250, c) && isFriend(262, c)) && m.common.length === adj[250].filter((c) => isFriend(262, c)).length;
console.log(`lists symmetric and sorted: ${symmetric}; mutual friends match the slow check: ${mutualOk}`);
if (!symmetric || !mutualOk || sumBoth >= sumPlain || capped.touched >= noCap.touched) process.exit(1);
