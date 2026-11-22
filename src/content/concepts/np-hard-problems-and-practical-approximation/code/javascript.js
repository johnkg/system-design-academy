// The traveling salesman problem (shortest round trip through n cities) as the standard example of an NP-hard problem.
// Part 1: how many tours exist, and how long checking them all would take at an ASSUMED one billion tours per second.
// Part 2: the same instance of 6 to 10 fixed cities (Manhattan distance, integers) solved four ways, counted in steps (a step is
//         one city added to a partial tour, or one pair of edges examined by 2-opt): brute force over every order, branch and bound
//         (abandon a partial tour once it is as long as the best known), nearest neighbour, and nearest neighbour plus 2-opt.
// Look for: tours grow factorially; exact answers are cheap for small n and still cheaper with pruning; nearest neighbour is fast and
// lands above the optimum on this instance (the gap varies with the instance); a little local improvement closes part of it.
// BigInt (JavaScript), int (Python) and BigInteger (C#) keep the huge counts exact, so all three languages print the same digits.
const CITIES = [[77, 29], [81, 47], [15, 50], [49, 61], [16, 31], [92, 18], [65, 84], [52, 18], [67, 64], [75, 2]];
const dist = (a, b) => Math.abs(CITIES[a][0] - CITIES[b][0]) + Math.abs(CITIES[a][1] - CITIES[b][1]);

const factorial = (n) => { let f = 1n; for (let i = 2n; i <= BigInt(n); i++) f *= i; return f; };
const NS_PER_SECOND = 1000000000n, SECONDS_PER_YEAR = 31536000n;
for (const n of [5, 10, 15, 20, 25]) {
  const tours = factorial(n - 1) / 2n; // fix the start city; a tour and its reverse are the same round trip
  const seconds = tours / NS_PER_SECOND;
  console.log(`n=${n}: ${tours} tours, ${seconds} seconds, ${seconds / SECONDS_PER_YEAR} years at one billion tours per second`);
}
// Held-Karp dynamic programming (exact, no enumeration): about n^2 * 2^n steps and n * 2^n stored values. Better, still exponential.
for (const n of [10, 20, 30, 40]) {
  const states = BigInt(n) * 2n ** BigInt(n);
  console.log(`n=${n}: dynamic programming about ${states * BigInt(n)} steps and ${states} stored values`);
}

function tourLength(order) {
  let s = 0;
  for (let i = 0; i < order.length; i++) s += dist(order[i], order[(i + 1) % order.length]);
  return s;
}

function bruteForce(n) { // every order of cities 1..n-1 after city 0
  let steps = 0, tours = 0, best = Infinity;
  const path = [0], used = new Array(n).fill(false);
  used[0] = true;
  (function extend(length) {
    if (path.length === n) { tours++; best = Math.min(best, length + dist(path[n - 1], 0)); return; }
    for (let c = 1; c < n; c++) {
      if (used[c]) continue;
      steps++;
      used[c] = true; path.push(c);
      extend(length + dist(path[path.length - 2], c));
      path.pop(); used[c] = false;
    }
  })(0);
  return { best, steps, tours };
}

function branchAndBound(n, bound) { // the same search, but a partial tour at least as long as the best known is dropped
  let steps = 0, best = bound;
  const path = [0], used = new Array(n).fill(false);
  used[0] = true;
  (function extend(length) {
    if (length >= best) return;
    if (path.length === n) { best = Math.min(best, length + dist(path[n - 1], 0)); return; }
    for (let c = 1; c < n; c++) {
      if (used[c]) continue;
      steps++;
      used[c] = true; path.push(c);
      extend(length + dist(path[path.length - 2], c));
      path.pop(); used[c] = false;
    }
  })(0);
  return { best, steps };
}

function nearestNeighbour(n) {
  const order = [0], used = new Array(n).fill(false);
  used[0] = true;
  let at = 0, steps = 0;
  for (let s = 1; s < n; s++) {
    let pick = -1;
    for (let c = 0; c < n; c++) {
      if (used[c]) continue;
      steps++;
      if (pick < 0 || dist(at, c) < dist(at, pick)) pick = c; // ties go to the lower city number
    }
    used[pick] = true; order.push(pick); at = pick;
  }
  return { order, steps };
}

function twoOpt(start) { // reverse a stretch of the tour whenever that shortens it, until no reversal helps
  const order = start.slice(), n = order.length;
  let steps = 0, moves = 0, improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        steps++;
        const a = order[i - 1], b = order[i], c = order[j], d = order[(j + 1) % n];
        if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d)) {
          for (let l = i, r = j; l < r; l++, r--) { const t = order[l]; order[l] = order[r]; order[r] = t; }
          moves++; improved = true;
        }
      }
    }
  }
  return { order, steps, moves };
}

for (const n of [6, 7, 8, 9, 10]) {
  const nn = nearestNeighbour(n), nnLen = tourLength(nn.order);
  const opt = twoOpt(nn.order), optLen = tourLength(opt.order);
  const bf = bruteForce(n), bb = branchAndBound(n, nnLen + 1);
  if (bf.best !== bb.best) throw new Error('exact methods disagree');
  console.log(`n=${n}: optimum ${bf.best}; brute force ${bf.tours} tours, ${bf.steps} steps; branch and bound ${bb.steps} steps; ` +
    `nearest neighbour ${nnLen} (${Math.floor((nnLen * 100) / bf.best)}% of optimum, ${nn.steps} steps); with 2-opt ${optLen} (${Math.floor((optLen * 100) / bf.best)}%, ${opt.moves} moves, ${opt.steps} steps)`);
}
