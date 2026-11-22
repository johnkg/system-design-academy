// Breadth-first and depth-first search on five graph shapes, counting edge checks, the widest the waiting list gets
// (queue for BFS, stack for DFS) and how deep a recursive DFS would go. No wall-clock time anywhere.
// Look for: BFS and DFS touch the same nodes and edges, but their memory differs by shape (BFS is widest on a star or a tree,
// DFS is deepest on a chain or a grid); only BFS finds the fewest-hops path; without a visited set the work explodes or never ends.
// DFS is "recursive" in order but runs on an explicit stack here, so the program never hits a recursion limit: it reports the
// depth a real recursive version would need.
// Graphs are built from fixed integer formulas. Neighbours are listed in the order the edges were added.

const CAP = 100000; // the no-visited-set runs stop after this many steps, so the program still ends

function build(shape, n) {
  if (shape === "grid") { // w x w squares: the largest w with w * w <= n
    let w = 0;
    while ((w + 1) * (w + 1) <= n) w++;
    n = w * w;
  }
  const adj = Array.from({ length: n }, () => []);
  const edge = (a, b) => {
    if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); }
  };
  if (shape === "chain") {
    for (let v = 0; v < n - 1; v++) edge(v, v + 1);
  } else if (shape === "tree") { // a complete binary tree, root 0
    for (let v = 1; v < n; v++) edge(Math.floor((v - 1) / 2), v);
  } else if (shape === "star") { // node 0 is a hub
    for (let v = 1; v < n; v++) edge(0, v);
  } else if (shape === "grid") { // right and down edges added first
    const w = Math.round(Math.sqrt(n));
    for (let v = 0; v < n; v++) {
      if (v % w < w - 1) edge(v, v + 1);
      if (Math.floor(v / w) < w - 1) edge(v, v + w);
    }
  } else { // random-looking: a ring plus one pseudo-random chord per node
    for (let v = 0; v < n; v++) {
      edge(v, (v + 1) % n);
      edge(v, (v * 7919 + 13) % n);
    }
  }
  return adj;
}

// Returns [nodes taken off the queue, edge checks, widest the queue got, hops to target or -1]. Stops when the target is dequeued.
function bfs(adj, start, target) {
  const seen = new Array(adj.length).fill(false);
  const dist = new Array(adj.length).fill(0);
  const queue = [start];
  let head = 0, nodes = 0, edges = 0, widest = 0;
  seen[start] = true;
  while (head < queue.length) {
    const v = queue[head++];
    nodes++;
    if (v === target) return [nodes, edges, widest, dist[v]];
    for (const w of adj[v]) {
      edges++;
      if (!seen[w]) { seen[w] = true; dist[w] = dist[v] + 1; queue.push(w); }
    }
    widest = Math.max(widest, queue.length - head);
  }
  return [nodes, edges, widest, -1];
}

// Recursive DFS on an explicit stack of [node, next neighbour index]. Returns [nodes entered, edge checks, deepest recursion in
// frames, length of the path to the target when it was entered or -1]. Stops at the target.
function dfs(adj, start, target) {
  const seen = new Array(adj.length).fill(false);
  const stack = [[start, 0]];
  seen[start] = true;
  let nodes = 1, edges = 0, deepest = 1;
  if (start === target) return [nodes, edges, deepest, 0];
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const v = top[0];
    if (top[1] === adj[v].length) { stack.pop(); continue; }
    const w = adj[v][top[1]++];
    edges++;
    if (!seen[w]) {
      seen[w] = true;
      nodes++;
      stack.push([w, 0]);
      deepest = Math.max(deepest, stack.length);
      if (w === target) return [nodes, edges, deepest, stack.length - 1];
    }
  }
  return [nodes, edges, deepest, -1];
}

// The other common DFS: pop a node, skip it if seen, mark it, push all its neighbours. The stack can hold a node many times.
function dfsPushAll(adj, start) {
  const seen = new Array(adj.length).fill(false);
  const stack = [start];
  let widest = 1;
  while (stack.length > 0) {
    const v = stack.pop();
    if (seen[v]) continue;
    seen[v] = true;
    for (const w of adj[v]) if (!seen[w]) stack.push(w);
    widest = Math.max(widest, stack.length);
  }
  return widest;
}

console.log("-- full traversal from node 0: edge checks, widest waiting list, deepest recursion");
for (const shape of ["chain", "tree", "star", "grid", "random"]) {
  for (const n of [100, 10000]) {
    const adj = build(shape, n);
    const [nodes, edges, queue] = bfs(adj, 0, -1);
    const [dn, de, depth] = dfs(adj, 0, -1);
    console.log(`${shape} n=${adj.length}: BFS visits ${nodes}, ${edges} edge checks, queue peaks at ${queue}; DFS visits ${dn}, ${de} edge checks, recursion depth ${depth}, push-all stack peaks at ${dfsPushAll(adj, 0)}`);
  }
}

console.log("-- the way to the far node (the last one; for random, the one halfway round): BFS against DFS");
for (const shape of ["tree", "grid", "random"]) {
  for (const n of [100, 10000]) {
    const adj = build(shape, n);
    const target = shape === "random" ? Math.floor(adj.length / 2) : adj.length - 1; // random: halfway round the ring
    const [bn, , , hops] = bfs(adj, 0, target);
    const [dn, , , length] = dfs(adj, 0, target);
    console.log(`${shape} n=${adj.length}: BFS path ${hops} edges after visiting ${bn} nodes; DFS path ${length} edges after visiting ${dn} nodes`);
  }
}

// Depth-first with no visited set, stopping at a step cap. Returns [steps, gave up].
function walkWithoutVisited(adj, start) {
  let steps = 0;
  const stack = [[start, 0]];
  while (stack.length > 0) {
    steps++;
    if (steps >= CAP) return [steps, true];
    const top = stack[stack.length - 1];
    const v = top[0];
    if (top[1] === adj[v].length) { stack.pop(); continue; }
    const w = adj[v][top[1]++];
    stack.push([w, 0]);
  }
  return [steps, false];
}

console.log("-- without a visited set");
for (const shape of ["chain", "tree", "grid"]) {
  const adj = build(shape, 100);
  const [steps, gaveUp] = walkWithoutVisited(adj, 0);
  console.log(`${shape} n=${adj.length}: ` + (gaveUp ? `gave up at ${steps} steps, still going` : `finished in ${steps} steps`));
}

// Directed chain of diamonds: both nodes of level l point to both nodes of level l + 1. Counts node entries from level 0.
function diamondWalk(levels, useVisited) {
  let entries = 0;
  const seen = new Set();
  const stack = [[0, 0]]; // [level, side]
  while (stack.length > 0) {
    const [level, side] = stack.pop();
    if (useVisited) {
      const key = level * 2 + side;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    entries++;
    if (level < levels) { stack.push([level + 1, 0]); stack.push([level + 1, 1]); }
  }
  return entries;
}

for (const levels of [5, 10, 15, 20]) {
  console.log(`diamond chain, ${levels} levels (${2 * levels + 1} nodes): without visited set ${diamondWalk(levels, false)} node entries, with one ${diamondWalk(levels, true)}`);
}
