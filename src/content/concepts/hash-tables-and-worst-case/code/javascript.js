// A chained hash table with a fixed number of buckets and a selectable hash function. A probe is one key compared
// while walking a chain. Inserts check the chain for the key first, then append; lookups walk until they find it.
// Look for: a good hash keeps chains short, so a lookup costs about 1 probe; a poor or constant hash, or keys an attacker
// chose to collide, put everything in a few chains and the cost becomes O(n) per lookup, O(n^2) in total.
// The chain walks use the language's own linear scan (includes / indexOf): a scan is exactly position + 1 comparisons.
const MULT = 2654435761;   // Knuth's multiplicative constant (odd, so multiplying mod 2^32 is reversible)
const MULT_INV = 244002641; // its inverse mod 2^32: an attacker uses it to craft colliding keys
const MIX = 2246822519;    // a second odd multiplier for the seeded hash's mixing steps
const SEED = 2718281828;   // the secret a randomised hash would pick at start-up (a fixed stand-in so the output repeats)

function bucketOf(fn, key, m) {
  if (fn === 'constant') return 0;
  if (fn === 'poor') return (key % 10) % m; // looks only at the last decimal digit
  if (fn === 'seeded') { // a keyed, better-mixed hash: a stand-in for what SipHash-style hashes do with a secret key
    let x = (key ^ SEED) >>> 0;
    x = Math.imul(x, MULT) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, MIX) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    return (x >>> 16) % m;
  }
  const h = Math.imul(key >>> 0, MULT) >>> 0; // multiplicative hash mod 2^32
  return Math.floor(h / 65536) % m;           // use the high 16 bits, which mix best
}

function makeKeys(pattern, fn, n) {
  const keys = [];
  let x = 12345;
  for (let i = 0; i < n; i++) {
    if (pattern === 'random') { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; keys.push(x); }
    else if (pattern === 'sequential') keys.push(i);
    else if (fn === 'poor') keys.push(i * 10);                  // adversarial for a last-digit hash: every key ends in 0
    else if (fn === 'constant') keys.push(i);                   // anything collides with a constant hash
    else keys.push(Math.imul(i, MULT_INV) >>> 0);               // crafted so the UNSEEDED hash of key i is i, high bits 0: bucket 0
  }
  return keys;
}

function run(fn, pattern, n, m) {
  const buckets = Array.from({ length: m }, () => []);
  const keys = makeKeys(pattern, fn, n);
  let insertProbes = 0, lookupProbes = 0;
  for (const k of keys) {
    const chain = buckets[bucketOf(fn, k, m)];
    if (chain.includes(k)) throw new Error('duplicate key');
    insertProbes += chain.length; // the walk that found no match
    chain.push(k);
  }
  for (const k of keys) lookupProbes += buckets[bucketOf(fn, k, m)].indexOf(k) + 1;
  const total = insertProbes + lookupProbes;
  const lens = buckets.map((b) => b.length);
  if (total !== lens.reduce((s, l) => s + l * l, 0)) throw new Error('model mismatch'); // inserts l(l-1)/2 + lookups l(l+1)/2
  const avg = Math.floor((lookupProbes * 100) / n);
  return `longest chain ${Math.max(...lens)}, buckets used ${lens.filter((l) => l > 0).length} of ${m}, ${Math.floor(avg / 100)}.${String(avg % 100).padStart(2, '0')} probes per lookup, ${total} probes in total`;
}

const scenarios = [
  ['good hash, random keys', 'good', 'random'],
  ['good hash, sequential keys', 'good', 'sequential'],
  ['poor hash (last digit), sequential keys', 'poor', 'sequential'],
  ['constant hash, sequential keys', 'constant', 'sequential'],
  ['good hash, attacker keys', 'good', 'adversarial'],
  ['seeded hash, attacker keys', 'seeded', 'adversarial'],
  ['poor hash (last digit), attacker keys', 'poor', 'adversarial'],
];
for (const [n, m] of [[100, 128], [10000, 16384]]) {
  console.log(`n=${n} keys, ${m} buckets (load factor ${Math.floor((n * 100) / m)}%)`);
  for (const [name, fn, pattern] of scenarios) console.log(`  ${name}: ${run(fn, pattern, n, m)}`);
}
