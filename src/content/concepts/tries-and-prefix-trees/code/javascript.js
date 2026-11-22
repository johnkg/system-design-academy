// Prefix search three ways, counted in character steps (one step = one character compared, or one trie node entered), never in time.
//   scan:   a hash map or list of words has no prefix structure, so every word is checked, character by character
//   sorted: words kept in order, binary search for the first word with the prefix, then read forward
//   trie:   one node per distinct prefix; walk the prefix, then read the subtree below it
// Look for: the trie's cost follows the prefix length and the answer size, not the number of words; its price is nodes.
// A fixed integer generator makes the words, so every language prints the same numbers. Alphabet for the memory model: 26 letters.
const SYLLABLES = ['ka', 'ro', 'mi', 'te', 'su', 'no', 'la', 'pe', 'vi', 'do', 'an', 'el', 'or', 'in', 'ta', 'ge'];
const ALPHABET = 26;

function makeWords(kind, n) {
  let x = 12345;
  const next = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x >>> 16; };
  const seen = new Set();
  const words = [];
  while (words.length < n) {
    let w = '';
    if (kind === 'words') { const parts = 2 + (next() % 3); for (let i = 0; i < parts; i++) w += SYLLABLES[next() % 16]; }
    else for (let i = 0; i < 8; i++) w += String.fromCharCode(97 + (next() % 26));
    if (!seen.has(w)) { seen.add(w); words.push(w); }
  }
  return words;
}

function scanSearch(words, prefix, limit) {
  let steps = 0, found = 0;
  for (const w of words) {
    let i = 0;
    while (i < prefix.length) { steps++; if (i >= w.length || w[i] !== prefix[i]) break; i++; }
    if (i === prefix.length) { found++; if (limit > 0 && found === limit) break; }
  }
  return { steps, found };
}

function sortedSearch(sorted, prefix, limit) {
  let steps = 0;
  const cmp = (w) => { // compares the first prefix.length characters of w with the prefix
    for (let i = 0; i < prefix.length; i++) { steps++; if (i >= w.length) return -1; if (w[i] !== prefix[i]) return w[i] < prefix[i] ? -1 : 1; }
    return 0;
  };
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(sorted[mid]) < 0) lo = mid + 1; else hi = mid; }
  let found = 0;
  for (let i = lo; i < sorted.length && cmp(sorted[i]) === 0; i++) { found++; if (limit > 0 && found === limit) break; }
  return { steps, found };
}

function buildTrie(words) {
  const nodes = [{ kids: new Map(), end: false }];
  for (const w of words) {
    let at = 0;
    for (const c of w) {
      if (!nodes[at].kids.has(c)) { nodes.push({ kids: new Map(), end: false }); nodes[at].kids.set(c, nodes.length - 1); }
      at = nodes[at].kids.get(c);
    }
    nodes[at].end = true;
  }
  return nodes;
}

function trieSearch(nodes, prefix, limit) {
  let steps = 0, found = 0, at = 0;
  for (const c of prefix) { if (!nodes[at].kids.has(c)) return { steps: steps + 1, found: 0 }; steps++; at = nodes[at].kids.get(c); }
  const visit = (id) => { // depth-first, letters in order; a node that ends a word is one result
    if (nodes[id].end) found++;
    if (limit > 0 && found >= limit) return true;
    for (const c of [...nodes[id].kids.keys()].sort()) { steps++; if (visit(nodes[id].kids.get(c))) return true; }
    return false;
  };
  visit(at);
  return { steps, found };
}

function compressedNodes(nodes) { // a radix tree keeps only the root, word ends and branch points
  return nodes.filter((nd, i) => i === 0 || nd.end || nd.kids.size >= 2).length;
}

for (const kind of ['words', 'ids']) {
  console.log(kind === 'words' ? 'word-like keys (shared prefixes)' : 'random 8-letter ids (little sharing)');
  for (const n of [100, 1000, 10000]) {
    const words = makeWords(kind, n);
    const nodes = buildTrie(words);
    const chars = words.reduce((s, w) => s + w.length, 0);
    console.log(`  n=${n}: ${chars} characters, trie ${nodes.length} nodes, radix tree ${compressedNodes(nodes)} nodes, child slots ${nodes.length * ALPHABET} as 26-slot arrays vs ${nodes.length - 1} as maps`);
  }
}

const words = makeWords('words', 10000);
const sorted = [...words].sort();
const nodes = buildTrie(words);
console.log(`prefix search over 10000 words, typed prefix "taka", one letter at a time`);
for (const limit of [0, 10]) {
  for (let len = 1; len <= 4; len++) {
    const p = "taka".slice(0, len);
    const a = scanSearch(words, p, limit), b = sortedSearch(sorted, p, limit), c = trieSearch(nodes, p, limit);
    if (limit === 0 && (a.found !== b.found || b.found !== c.found)) throw new Error('methods disagree');
    console.log(`  ${limit === 0 ? 'all matches' : 'first ' + limit} for "${p}": scan ${a.steps} steps, sorted ${b.steps}, trie ${c.steps} (${c.found} found)`);
  }
}
