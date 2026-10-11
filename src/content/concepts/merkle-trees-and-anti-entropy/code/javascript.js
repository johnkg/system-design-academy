// Merkle tree anti-entropy: find and repair the key ranges where two replicas differ.
import crypto from "node:crypto";

const N_KEYS = 4096, LEAVES = 64, PER_LEAF = N_KEYS / LEAVES; // 64 keys per leaf range
const sha = (buf) => crypto.createHash("sha256").update(buf).digest();

function buildTree(store) {
  // Leaf i hashes the sorted "key=value" lines of its key range; parents hash their two children.
  let level = [];
  for (let i = 0; i < LEAVES; i++) {
    let text = "";
    for (let k = i * PER_LEAF; k < (i + 1) * PER_LEAF; k++) if (store.has(k)) text += `${k}=${store.get(k)}\n`;
    level.push(sha(Buffer.from(text)));
  }
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha(Buffer.concat([level[i], level[i + 1]])));
    levels.unshift(next);
    level = next;
  }
  return levels; // levels[0] = [root], levels[last] = leaves
}

function diff(a, b, depth, idx, stats, out) {
  stats.comparisons++; // one hash exchanged and compared
  if (a[depth][idx].equals(b[depth][idx])) return;
  if (depth === a.length - 1) { out.push(idx); return; }
  diff(a, b, depth + 1, 2 * idx, stats, out);
  diff(a, b, depth + 1, 2 * idx + 1, stats, out);
}

// Replica A is the source of truth; B has drifted.
const a = new Map();
for (let k = 0; k < N_KEYS; k++) a.set(k, `v${(k * 7) % 1000}`);
const b = new Map(a);

let seed = 42; // MINSTD generator
const rand = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
for (let i = 0; i < 4; i++) b.set(rand(N_KEYS), "stale"); // missed writes
b.delete(rand(N_KEYS)); // lost write

const ta = buildTree(a), tb = buildTree(b);
console.log(`roots equal before: ${ta[0][0].equals(tb[0][0])}`);
const stats = { comparisons: 0 }, ranges = [];
diff(ta, tb, 0, 0, stats, ranges);
console.log(`differing ranges: ${ranges.length} -> [${ranges.join(", ")}]`);
console.log(`hash comparisons: ${stats.comparisons} (${stats.comparisons * 32} bytes), keys: ${N_KEYS}, flat list: ${LEAVES} hashes`);

let sent = 0;
for (const i of ranges) {
  for (let k = i * PER_LEAF; k < (i + 1) * PER_LEAF; k++) {
    if (a.has(k)) b.set(k, a.get(k)); else b.delete(k);
    sent++;
  }
}
console.log(`keys transferred: ${sent} of ${N_KEYS}`);
const tb2 = buildTree(b);
console.log(`roots equal after: ${ta[0][0].equals(tb2[0][0])}, root ${ta[0][0].toString("hex").slice(0, 8)}`);

if (!ta[0][0].equals(tb2[0][0])) process.exit(1);
if (stats.comparisons * 20 >= N_KEYS) process.exit(1);
if (sent > ranges.length * PER_LEAF) process.exit(1);
