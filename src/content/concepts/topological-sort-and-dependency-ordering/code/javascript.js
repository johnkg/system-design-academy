// Topological sort on a build-dependency graph, counting operations (node visits + edge visits), not time.
// Three ways to order tasks so every task comes after the tasks it depends on:
//   scan  : the "obvious" loop, rescans every task each time it needs the next ready one
//   kahn  : count unfinished dependencies per task, release a task when its count reaches 0
//   dfs   : depth-first, emit a task after all of its dependencies
// Look for: scan grows with the square of n, Kahn and DFS with n + edges; a cycle is detected, never ordered;
// tasks downstream of a cycle are stuck too, so the "stuck" count is larger than the cycle itself;
// the number of levels (the critical path) limits how much extra workers can help.

// Task labels are scrambled so that ids do not already come in dependency order.
const label = (i, n) => (i * 37 + 11) % n;

function build(n, withCycle) {
  const deps = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const d = [];
    if (i % 4 !== 0) d.push(label(i - 1, n));
    for (let j = Math.max(0, i - 8); j < i - 1; j++) {
      if ((i * 7 + j * 13) % 9 === 0) d.push(label(j, n));
    }
    deps[label(i, n)] = d;
  }
  if (withCycle) {
    const a = 4 * Math.floor(n / 8) + 1; // a depends on a+2, which depends on a+1, which depends on a: a 3-task cycle
    deps[label(a, n)].push(label(a + 2, n));
  }
  return deps;
}

const countEdges = (deps) => deps.reduce((sum, d) => sum + d.length, 0);

// 1. Scan: restart from the first task every time, pick the first unfinished task whose dependencies are all done.
function scanSort(deps) {
  const n = deps.length;
  let ops = 0;
  const done = new Array(n).fill(false);
  const order = [];
  while (order.length < n) {
    let picked = -1;
    for (let t = 0; t < n; t++) {
      ops++;
      if (done[t]) continue;
      let ready = true;
      for (const d of deps[t]) {
        ops++;
        if (!done[d]) { ready = false; break; }
      }
      if (ready) { picked = t; break; }
    }
    if (picked < 0) break; // nothing is ready: a cycle (without this guard the loop would never end)
    done[picked] = true;
    order.push(picked);
  }
  return { order, ops };
}

// 2. Kahn: indegree = number of unfinished dependencies; a queue holds the ready tasks.
function kahnSort(deps) {
  const n = deps.length;
  let ops = 0;
  const dependents = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let t = 0; t < n; t++) {
    for (const d of deps[t]) {
      ops++;
      dependents[d].push(t);
      indeg[t]++;
    }
  }
  const queue = [];
  for (let t = 0; t < n; t++) {
    ops++;
    if (indeg[t] === 0) queue.push(t);
  }
  let head = 0;
  const order = [];
  while (head < queue.length) {
    const t = queue[head++];
    ops++;
    order.push(t);
    for (const u of dependents[t]) {
      ops++;
      indeg[u]--;
      if (indeg[u] === 0) queue.push(u);
    }
  }
  return { order, ops };
}

// 3. DFS with three colours: 0 = not seen, 1 = on the current path, 2 = finished. Meeting a 1 means a cycle.
function dfsSort(deps) {
  const n = deps.length;
  const colour = new Array(n).fill(0);
  const order = [];
  let ops = 0;
  let cycleAt = -1;
  function visit(t) {
    ops++;
    colour[t] = 1;
    for (const d of deps[t]) {
      ops++;
      if (colour[d] === 1) {
        if (cycleAt < 0) cycleAt = d;
      } else if (colour[d] === 0) {
        visit(d);
      }
    }
    colour[t] = 2;
    order.push(t);
  }
  for (let t = 0; t < n; t++) {
    ops++;
    if (colour[t] === 0) visit(t);
  }
  return { order, ops, cycleAt };
}

function valid(order, deps) {
  const pos = new Map(order.map((t, i) => [t, i]));
  return order.every((t) => deps[t].every((d) => pos.get(d) < pos.get(t)));
}

// Levels: level 1 = no dependencies, otherwise 1 + the highest level among dependencies (the critical path length).
function levels(deps) {
  const { order } = kahnSort(deps);
  const lv = new Array(deps.length).fill(0);
  let top = 0;
  for (const t of order) {
    let best = 0;
    for (const d of deps[t]) best = Math.max(best, lv[d]);
    lv[t] = 1 + best;
    top = Math.max(top, lv[t]);
  }
  return top;
}

// Makespan with w workers, every task takes 1 time unit: each step runs up to w ready tasks (lowest id first).
function makespan(deps, w) {
  const n = deps.length;
  const dependents = Array.from({ length: n }, () => []);
  const indeg = deps.map((d) => d.length);
  for (let t = 0; t < n; t++) for (const d of deps[t]) dependents[d].push(t);
  let ready = [];
  for (let t = 0; t < n; t++) if (indeg[t] === 0) ready.push(t);
  let steps = 0;
  let finished = 0;
  while (finished < n) {
    const batch = ready.slice(0, w);
    ready = ready.slice(w);
    steps++;
    finished += batch.length;
    for (const t of batch) {
      for (const u of dependents[t]) {
        indeg[u]--;
        if (indeg[u] === 0) ready.push(u);
      }
    }
    ready.sort((a, b) => a - b);
  }
  return steps;
}

console.log("-- operations to order a build, n tasks (no cycle)");
for (const n of [10, 100, 1000]) {
  const deps = build(n, false);
  const s = scanSort(deps), k = kahnSort(deps), d = dfsSort(deps);
  const ok = valid(s.order, deps) && valid(k.order, deps) && valid(d.order, deps) && s.order.length === n;
  console.log(`  n=${n}: edges ${countEdges(deps)}, scan ${s.ops}, kahn ${k.ops}, dfs ${d.ops}, all valid orders: ${ok ? "True" : "False"}`);
}

console.log("-- the same build with one 3-task cycle added");
for (const n of [10, 100, 1000]) {
  const deps = build(n, true);
  const s = scanSort(deps), k = kahnSort(deps), d = dfsSort(deps);
  console.log(`  n=${n}: scan ordered ${s.order.length} of ${n} in ${s.ops} ops, kahn ordered ${k.order.length} of ${n} in ${k.ops} ops, ` +
    `dfs found a cycle: ${d.cycleAt >= 0 ? "True" : "False"} in ${d.ops} ops, tasks stuck behind the cycle: ${n - k.order.length}`);
}

console.log("-- levels and parallel build time (1 unit per task)");
for (const n of [10, 100, 1000]) {
  const deps = build(n, false);
  console.log(`  n=${n}: levels ${levels(deps)}, 1 worker ${makespan(deps, 1)}, 4 workers ${makespan(deps, 4)}, 16 workers ${makespan(deps, 16)}, unlimited workers ${makespan(deps, n)}`);
}
