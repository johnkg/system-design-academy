// A plain binary search tree against an AVL tree (a BST that rotates to stay balanced), counted in key comparisons, never in time.
// Keys are inserted in three orders: sorted, random (a fixed shuffle) and zigzag (smallest, largest, next smallest, ...).
// Look for: the plain BST on sorted or zigzag input is a list in disguise (height n, about n^2/2 comparisons); the AVL tree
// keeps its height near log2(n) on every order, and pays with a few rotations. The last lines count levels of a B-tree by fanout.
// The plain BST is built with loops (a degenerate tree is as deep as it is long); the AVL tree uses recursion, which stays shallow.
function makeKeys(order, n) {
  const keys = [];
  if (order === 'sorted') for (let i = 1; i <= n; i++) keys.push(i);
  else if (order === 'zigzag') { let lo = 1, hi = n; while (lo <= hi) { keys.push(lo++); if (lo <= hi) keys.push(hi--); } }
  else {
    for (let i = 1; i <= n; i++) keys.push(i);
    let x = 12345;
    for (let i = n - 1; i > 0; i--) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      const j = (x >>> 16) % (i + 1);
      const t = keys[i]; keys[i] = keys[j]; keys[j] = t;
    }
  }
  return keys;
}

// Both trees store nodes in arrays: key[], left[], right[] (-1 means no child), height[] for the AVL tree.
function plainBst(keys) {
  const key = [], left = [], right = [];
  let comparisons = 0, root = -1;
  for (const k of keys) {
    key.push(k); left.push(-1); right.push(-1);
    const id = key.length - 1;
    if (root < 0) { root = id; continue; }
    let at = root;
    for (;;) {
      comparisons++;
      const side = k < key[at] ? left : right;
      if (side[at] < 0) { side[at] = id; break; }
      at = side[at];
    }
  }
  return { ...measure(root, left, right), comparisons, rotations: 0 };
}

function avlTree(keys) {
  const key = [], left = [], right = [], height = [];
  let comparisons = 0, rotations = 0;
  const h = (id) => (id < 0 ? 0 : height[id]);
  const fix = (id) => { height[id] = 1 + Math.max(h(left[id]), h(right[id])); };
  const rotateRight = (y) => { const x = left[y]; left[y] = right[x]; right[x] = y; fix(y); fix(x); rotations++; return x; };
  const rotateLeft = (x) => { const y = right[x]; right[x] = left[y]; left[y] = x; fix(x); fix(y); rotations++; return y; };
  function insert(at, id) {
    if (at < 0) return id;
    comparisons++;
    if (key[id] < key[at]) left[at] = insert(left[at], id); else right[at] = insert(right[at], id);
    fix(at);
    const balance = h(left[at]) - h(right[at]);
    if (balance > 1) { if (h(left[left[at]]) < h(right[left[at]])) left[at] = rotateLeft(left[at]); return rotateRight(at); }
    if (balance < -1) { if (h(right[right[at]]) < h(left[right[at]])) right[at] = rotateRight(right[at]); return rotateLeft(at); }
    return at;
  }
  let root = -1;
  for (const k of keys) {
    key.push(k); left.push(-1); right.push(-1); height.push(1);
    root = insert(root, key.length - 1);
  }
  return { ...measure(root, left, right), comparisons, rotations };
}

// Height and the sum of (depth + 1) over all nodes: looking every key up once costs exactly that many comparisons.
function measure(root, left, right) {
  let height = 0, lookups = 0;
  const stack = [[root, 1]];
  while (stack.length) {
    const [id, depth] = stack.pop();
    if (id < 0) continue;
    height = Math.max(height, depth);
    lookups += depth;
    stack.push([left[id], depth + 1], [right[id], depth + 1]);
  }
  return { height, lookups };
}

const hundredths = (a, b) => { const v = Math.floor((a * 100) / b); return `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`; };

for (const n of [10, 100, 1000, 10000]) {
  console.log(`n=${n}`);
  for (const order of ['sorted', 'zigzag', 'random']) {
    const keys = makeKeys(order, n);
    const a = plainBst(keys), b = avlTree(keys);
    console.log(`  ${order}: plain BST height ${a.height}, ${a.comparisons} comparisons to build, ${hundredths(a.lookups, n)} per lookup; AVL height ${b.height}, ${b.comparisons} comparisons, ${b.rotations} rotations, ${hundredths(b.lookups, n)} per lookup`);
  }
}

function levels(n, fanout) { // smallest h such that a full tree of height h holds n keys: fanout^h - 1 >= n
  let h = 0, capacity = 1;
  while (capacity - 1 < n) { capacity *= fanout; h++; }
  return h;
}
for (const n of [1000000, 1000000000]) {
  console.log(`levels to hold ${n} keys: ${[2, 100, 500].map((f) => `fanout ${f}: ${levels(n, f)}`).join(', ')}`);
}
