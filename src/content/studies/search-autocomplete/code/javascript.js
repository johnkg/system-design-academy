// A trie that stores the best suggestions at every node, in JavaScript:
// answering a prefix is a walk down the letters of the prefix, never a search through everything that starts with it.

const K = 5; // suggestions kept per node

class Node {
  constructor() { this.children = new Map(); this.top = []; } // top: the K most popular queries that pass through this node
}

// Order: more popular first, and alphabetical when equal, so results are the same on every run.
const better = (a, b) => b.count - a.count || (a.query < b.query ? -1 : a.query > b.query ? 1 : 0);

class Trie {
  constructor() { this.root = new Node(); }

  insert(query, count) {
    let node = this.root;
    const entry = { query, count };
    node.top = this.keepBest(node.top, entry);
    for (const ch of query) {
      if (!node.children.has(ch)) node.children.set(ch, new Node());
      node = node.children.get(ch);
      node.top = this.keepBest(node.top, entry); // every node on the path remembers this query if it is good enough
    }
  }

  keepBest(list, entry) {
    return [...list, entry].sort(better).slice(0, K);
  }

  suggest(prefix) {
    let node = this.root;
    for (const ch of prefix) {
      node = node.children.get(ch);
      if (!node) return []; // nothing starts with this prefix
    }
    return node.top.map((e) => e.query);
  }
}

const logs = [
  ['car insurance', 9200], ['car rental', 7400], ['cat food', 6100], ['cake recipe', 5200], ['car wash near me', 4800],
  ['cat videos', 4400], ['cars movie', 3900], ['cake pops', 1200], ['carpet cleaning', 1100], ['cabin rentals', 900],
  ['weather today', 12000], ['weather tomorrow', 5000], ['web hosting', 3100], ['wedding dresses', 2800],
];

const trie = new Trie();
for (const [query, count] of logs) trie.insert(query, count);

// Check every prefix against the slow way: scan all queries, filter, sort.
let mismatches = 0;
for (const prefix of ['c', 'ca', 'car', 'cat', 'w', 'we', 'wea', 'x']) {
  const fast = trie.suggest(prefix);
  const slow = logs.map(([query, count]) => ({ query, count })).filter((e) => e.query.startsWith(prefix)).sort(better).slice(0, K).map((e) => e.query);
  if (JSON.stringify(fast) !== JSON.stringify(slow)) mismatches++;
  console.log(`"${prefix}" -> ${fast.length ? fast.join(' | ') : '(none)'}`);
}
if (mismatches > 0) process.exit(1);
