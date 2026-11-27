// Byte-pair encoding in JavaScript: learn merges from a tiny corpus, then encode new words.
const CORPUS = [["low", 5], ["lower", 2], ["newest", 6], ["widest", 3]]; // [word, how often it appears]
const MERGES = 8;

function pairCounts(words) {
  const counts = new Map(); // insertion order breaks ties: the first pair seen with the top count wins
  for (const { symbols, freq } of words) {
    for (let i = 0; i < symbols.length - 1; i++) {
      const key = `${symbols[i]}\u0001${symbols[i + 1]}`;
      counts.set(key, (counts.get(key) ?? 0) + freq);
    }
  }
  return counts;
}

function applyMerge(symbols, a, b) {
  const out = [];
  for (let i = 0; i < symbols.length; i++) {
    if (i < symbols.length - 1 && symbols[i] === a && symbols[i + 1] === b) {
      out.push(a + b);
      i += 1;
    } else {
      out.push(symbols[i]);
    }
  }
  return out;
}

let words = CORPUS.map(([word, freq]) => ({ symbols: [...word, "_"], freq })); // "_" marks the end of a word
const characters = new Set(words.flatMap((w) => w.symbols));
const merges = [];
for (let n = 1; n <= MERGES; n++) {
  let best = null;
  let bestCount = 0;
  for (const [key, count] of pairCounts(words)) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  const [a, b] = best.split("\u0001");
  merges.push([a, b]);
  console.log(`merge ${n}: ${a} + ${b} -> ${a + b} (count ${bestCount})`);
  words = words.map((w) => ({ symbols: applyMerge(w.symbols, a, b), freq: w.freq }));
}

function encode(word) {
  let symbols = [...word, "_"];
  for (const [a, b] of merges) symbols = applyMerge(symbols, a, b); // in the order they were learned
  return symbols;
}

for (const word of ["lowest", "newer", "wider"]) console.log(`${word} -> [${encode(word).join(", ")}]`);
console.log(`vocabulary size: ${characters.size} characters + ${merges.length} merges = ${characters.size + merges.length}`);
