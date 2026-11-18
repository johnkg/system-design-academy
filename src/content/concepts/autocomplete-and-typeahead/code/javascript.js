// Autocomplete: suggest completions of a typed prefix, most popular first. Four ways to answer, compared by how many
// entries each one looks at for one keystroke and how many entries it keeps in memory. Integers only.
const QUERIES = [
  ['ipad', 5200], ['ipad case', 2100], ['ipad pro', 3300], ['iphone', 9800], ['iphone 15', 8700], ['iphone 15 case', 4100],
  ['iphone 15 pro', 3900], ['iphone charger', 2600], ['iphone case', 3000], ['ipod', 600], ['ice maker', 900],
  ['ice cream maker', 1500], ['icon pack', 300], ['ikea desk', 1800], ['ikea shelf', 1100], ['headphones', 7600],
  ['headphones wireless', 3400], ['hdmi cable', 2300], ['hard drive', 2800], ['hair dryer', 4300], ['laptop', 8100],
  ['laptop stand', 2500], ['laptop bag', 2000], ['laptop charger', 3100], ['lamp', 1400], ['keyboard', 6200],
  ['keyboard mechanical', 2900], ['kindle', 3600], ['kitchen scale', 800], ['monitor', 5900], ['monitor arm', 1700],
  ['mouse', 5400], ['mouse pad', 2200], ['microwave', 2400], ['mattress', 3700], ['phone case', 6800],
  ['phone charger', 4600], ['power bank', 3500], ['printer', 4900], ['printer ink', 2700],
];
const SORTED = [...QUERIES].sort((a, b) => (a[0] < b[0] ? -1 : 1));  // alphabetical, for the sorted list and for tie-breaks
const MAX_GRAM = 20;                                                // longest prefix indexed as an edge n-gram

const byPopularity = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
const matches = (prefix) => SORTED.filter((q) => q[0].startsWith(prefix));
const pick = (list, k, popular) => (popular ? [...list].sort(byPopularity) : list).slice(0, k).map((q) => q[0]);

// A trie of all queries: node = { kids: {char: node}, query: [text, count] | null }.
const root = { kids: {}, query: null };
let nodes = 0;
for (const q of SORTED) {
  let n = root;
  for (const ch of q[0]) { if (!n.kids[ch]) { n.kids[ch] = { kids: {}, query: null }; nodes++; } n = n.kids[ch]; }
  n.query = q;
}
const subtree = (n, out = []) => { if (n.query) out.push(n.query); for (const ch of Object.keys(n.kids).sort()) subtree(n.kids[ch], out); return out; };
const size = (n) => 1 + Object.values(n.kids).reduce((s, c) => s + size(c), 0);

// Method 1: sorted list. Binary search finds the first entry that could match, then the scan reads every match.
function sortedList(prefix, k, popular) {
  let lo = 0, hi = SORTED.length, compares = 0;
  while (lo < hi) { const mid = (lo + hi) >> 1; compares++; if (SORTED[mid][0] < prefix) lo = mid + 1; else hi = mid; }
  const found = [];
  let looked = compares;
  for (let i = lo; i < SORTED.length; i++) {
    looked++;
    if (!SORTED[i][0].startsWith(prefix)) break;   // the first non-match ends the scan
    found.push(SORTED[i]);
    if (!popular && found.length === k) break;       // alphabetical order can stop after k matches
  }
  return { results: pick(found, k, popular), looked, memory: SORTED.length };
}

// Method 2: trie. Walk down the prefix, then visit every node under it to find the completions.
function trie(prefix, k, popular) {
  let n = root, looked = 0;
  for (const ch of prefix) { n = n.kids[ch]; if (!n) return { results: [], looked, memory: nodes }; looked++; }
  if (!popular) {                                    // depth-first in letter order, stop at k completions
    const found = [];
    const walk = (m) => { if (found.length >= k) return; looked++; if (m.query) found.push(m.query); for (const ch of Object.keys(m.kids).sort()) walk(m.kids[ch]); };
    walk(n); looked--;                               // the prefix node was already counted
    return { results: found.map((q) => q[0]), looked, memory: nodes };
  }
  looked += size(n) - 1;
  return { results: pick(subtree(n), k, true), looked, memory: nodes };
}

// Method 3: trie with the top k completions stored at every node. Reading the answer is the walk plus k entries.
function topK(prefix, k, popular) {
  let n = root, looked = 0;
  let stored = 0;
  const count = (m) => { const c = subtree(m).length; stored += Math.min(k, c); for (const ch of Object.keys(m.kids)) count(m.kids[ch]); };
  count(root);
  for (const ch of prefix) { n = n.kids[ch]; if (!n) return { results: [], looked, memory: nodes + stored }; looked++; }
  const results = pick(subtree(n), k, popular);
  return { results, looked: looked + results.length, memory: nodes + stored };
}

// Method 4: edge n-grams in a search index. Every query is indexed under each of its prefixes; one term lookup returns a postings list.
function edgeNgram(prefix, k, popular) {
  const postings = new Map();
  let total = 0;
  for (const q of SORTED) for (let len = 1; len <= Math.min(q[0].length, MAX_GRAM); len++) {
    const term = q[0].slice(0, len);
    if (!postings.has(term)) postings.set(term, []);
    postings.get(term).push(q); total++;
  }
  const list = postings.get(prefix) || [];
  return { results: pick(list, k, popular), looked: 1 + (popular ? list.length : Math.min(k, list.length)), memory: postings.size + total };
}

const METHODS = [['sorted list + binary search', sortedList], ['trie', trie], ['trie with top-k at each node', topK], ['edge n-grams in an index', edgeNgram]];
console.log(`${QUERIES.length} queries, ${nodes} trie nodes (distinct prefixes)`);
for (const [prefix, k, popular] of [['ip', 3, true], ['i', 3, true], ['iphone 15', 3, true], ['ip', 3, false]]) {
  console.log(`prefix "${prefix}", top ${k}, ${popular ? 'most popular first' : 'alphabetical'}`);
  for (const [name, fn] of METHODS) {
    const r = fn(prefix, k, popular);
    console.log(`  ${name}: looked at ${r.looked}, stores ${r.memory}; ${r.results.join(' | ')}`);
  }
}

// One person types "iphone 15 case". Gaps are the milliseconds between key presses. A request fires after a key if the typist then pauses
// for at least the debounce time (or it was the last key). The first CACHE characters are answered from a cache and never reach the backend.
const GAPS = [120, 110, 140, 100, 130, 90, 250, 120, 110, 260, 130, 100, 120];
const TEXT = 'iphone 15 case';
function typing(debounce, cacheChars) {
  const lengths = [];
  for (let i = 0; i < TEXT.length; i++) if (debounce === 0 || i === TEXT.length - 1 || GAPS[i] >= debounce) lengths.push(i + 1);
  const backend = lengths.filter((len) => len > cacheChars).length;
  return { sent: lengths.length, backend };
}
console.log(`typing "${TEXT}" (${TEXT.length} keystrokes)`);
for (const [d, c] of [[0, 0], [0, 2], [100, 0], [200, 0], [200, 2]]) {
  const r = typing(d, c);
  console.log(`  debounce ${d} ms, cache first ${c} characters: ${r.sent} requests sent, ${r.backend} reach the backend, ${r.backend * 10000} for 10000 people`);
}
if (sortedList('ip', 3, true).results.join() !== trie('ip', 3, true).results.join() || topK('ip', 3, true).results.join() !== edgeNgram('ip', 3, true).results.join()) throw new Error('methods disagree');
