// String matching and regex backtracking: count character comparisons, never time.
// Look for: naive search costs about n * m on a repetitive text, KMP stays under 2n, and a nested-quantifier regex doubles its step
// count with every extra character when the input almost matches, while the set-based matcher stays polynomial.
// The regex engine below is a small explicit matcher written for this sample. Patterns are trees: ["lit", c], ["seq", [..]],
// ["alt", [..]], ["plus", node]. Every pattern is anchored at both ends, like ^...$.
let steps = 0;

function naiveSearch(text, pat) { // comparisons made while trying every start position
  steps = 0;
  for (let s = 0; s <= text.length - pat.length; s++) {
    let j = 0;
    for (; j < pat.length; j++) {
      steps++;
      if (text[s + j] !== pat[j]) break;
    }
    if (j === pat.length) return s;
  }
  return -1;
}

function kmpSearch(text, pat) { // one comparison per attempt; the text index never moves back
  steps = 0;
  const fail = new Array(pat.length).fill(0);
  let k = 0;
  for (let i = 1; i < pat.length; i++) {
    while (k > 0 && pat[i] !== pat[k]) { steps++; k = fail[k - 1]; }
    steps++;
    if (pat[i] === pat[k]) k++;
    fail[i] = k;
  }
  k = 0;
  for (let i = 0; i < text.length; i++) {
    while (k > 0 && text[i] !== pat[k]) { steps++; k = fail[k - 1]; }
    steps++;
    if (text[i] === pat[k]) k++;
    if (k === pat.length) return i - k + 1;
  }
  return -1;
}

function bt(node, s, i, k) { // backtracking: try a branch, and if the rest of the match fails, come back and try another
  const kind = node[0];
  if (kind === "lit") {
    steps++;
    return i < s.length && s[i] === node[1] && k(i + 1);
  }
  if (kind === "seq") {
    const run = (idx, j) => (idx === node[1].length ? k(j) : bt(node[1][idx], s, j, (j2) => run(idx + 1, j2)));
    return run(0, i);
  }
  if (kind === "alt") {
    for (const option of node[1]) if (bt(option, s, i, k)) return true;
    return false;
  }
  return bt(node[1], s, i, (j) => bt(node, s, j, k) || k(j)); // plus: one more repeat first, then stop
}

function matchBacktracking(pat, s) {
  steps = 0;
  return bt(pat, s, 0, (j) => j === s.length);
}

function ends(node, s, starts) { // set-based: all end positions reachable from each start, every start looked at once
  const kind = node[0];
  if (kind === "lit") {
    const out = new Set();
    for (const i of starts) {
      steps++;
      if (i < s.length && s[i] === node[1]) out.add(i + 1);
    }
    return out;
  }
  if (kind === "seq") {
    let cur = new Set(starts);
    for (const part of node[1]) cur = ends(part, s, cur);
    return cur;
  }
  if (kind === "alt") {
    const out = new Set();
    for (const option of node[1]) for (const e of ends(option, s, starts)) out.add(e);
    return out;
  }
  const seen = new Set(), out = new Set(); // plus: repeat until no new positions appear
  let frontier = new Set(starts);
  while (frontier.size > 0) {
    const nxt = ends(node[1], s, new Set([...frontier].filter((x) => !seen.has(x))));
    for (const x of frontier) seen.add(x);
    for (const x of nxt) out.add(x);
    frontier = new Set([...nxt].filter((x) => !seen.has(x)));
  }
  return out;
}

function matchSets(pat, s) {
  steps = 0;
  return ends(pat, s, new Set([0])).has(s.length);
}

const A = ["lit", "a"];
const NESTED = ["plus", ["plus", A]]; // ^(a+)+$
const AMBIG = ["plus", ["alt", [A, ["seq", [A, A]]]]]; // ^(a|aa)+$
const SIMPLE = ["plus", A]; // ^a+$

for (const n of [10, 100, 1000]) {
  const text = "a".repeat(n);
  const pat = "a".repeat(9) + "b";
  naiveSearch(text, pat);
  const a = steps;
  kmpSearch(text, pat);
  console.log(`text of ${n} a's, pattern aaaaaaaaab: naive ${a} comparisons, KMP ${steps}`);
}

for (const [name, pat] of [["^(a+)+$", NESTED], ["^(a|aa)+$", AMBIG], ["^a+$", SIMPLE]]) {
  for (const n of [10, 15, 20]) {
    const text = "a".repeat(n) + "b"; // a near miss: all a's, then one character that spoils it
    const ok = matchBacktracking(pat, text);
    const btSteps = steps;
    matchSets(pat, text);
    console.log(`${name} on ${n} a's then b: backtracking ${btSteps} steps (match ${ok ? "yes" : "no"}), set-based ${steps} steps`);
  }
}

for (const n of [10, 15, 20]) {
  const ok = matchBacktracking(NESTED, "a".repeat(n)); // the same pattern on an input that does match
  console.log(`^(a+)+$ on ${n} a's with no b: backtracking ${steps} steps (match ${ok ? "yes" : "no"})`);
}

// Two rules found by measuring the engine, checked here for n up to 20, then used for larger n.
const nested = [], ambig = [];
for (let n = 0; n <= 20; n++) {
  matchBacktracking(NESTED, "a".repeat(n) + "b");
  nested.push(steps);
  matchBacktracking(AMBIG, "a".repeat(n) + "b");
  ambig.push(steps);
}
let okNested = true, okAmbig = true;
for (let n = 1; n <= 20; n++) if (nested[n] !== 2 ** (n + 1) - 1) okNested = false;
for (let n = 2; n <= 20; n++) if (ambig[n] !== ambig[n - 1] + ambig[n - 2] + 3) okAmbig = false;
console.log(`nested steps = 2^(n+1) - 1 for n = 1..20: ${okNested ? "yes" : "no"}`);
console.log(`alternation steps = previous + the one before + 3 for n = 2..20: ${okAmbig ? "yes" : "no"}`);
for (const n of [30, 40, 50]) {
  let a = ambig[19], b = ambig[20];
  for (let i = 0; i < n - 20; i++) { const t = a + b + 3; a = b; b = t; }
  console.log(`by the rules, n=${n}: nested ${2 ** (n + 1) - 1} steps, alternation ${b} steps, set-based ${2 * n + 1} and ${3 * n + 2}`);
}
