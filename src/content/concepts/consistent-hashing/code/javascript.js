// Consistent hashing in JavaScript: a hash ring with virtual nodes.

function hash32(text) { // FNV-1a followed by a bit mixer, so similar strings land far apart
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

class HashRing {
  #points = []; // { pos, node } sorted by position around the ring
  constructor(virtualNodes = 100) { this.virtualNodes = virtualNodes; }

  addNode(name) {
    for (let i = 0; i < this.virtualNodes; i++) this.#points.push({ pos: hash32(`${name}#${i}`), node: name });
    this.#points.sort((a, b) => a.pos - b.pos);
  }

  removeNode(name) { this.#points = this.#points.filter((p) => p.node !== name); }

  nodeFor(key) { // first point at or after the key's position, wrapping past the end
    const h = hash32(String(key));
    let lo = 0, hi = this.#points.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.#points[mid].pos < h) lo = mid + 1; else hi = mid; }
    return this.#points[lo % this.#points.length].node;
  }
}

const keys = Array.from({ length: 10000 }, (_, i) => `key-${i}`);
const ring = new HashRing(100);
["A", "B", "C"].forEach((n) => ring.addNode(n));

const before = new Map(keys.map((k) => [k, ring.nodeFor(k)]));
const load = {};
for (const node of before.values()) load[node] = (load[node] ?? 0) + 1;
console.log("keys per node:", JSON.stringify(load));

ring.addNode("D");
const movedRing = keys.filter((k) => before.get(k) !== ring.nodeFor(k)).length;
const movedMod = keys.filter((k) => hash32(k) % 3 !== hash32(k) % 4).length;
console.log(`adding a 4th node moves ${(movedRing / 100).toFixed(1)}% of keys on the ring, ${(movedMod / 100).toFixed(1)}% with hash mod N`);
