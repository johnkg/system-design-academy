// A content-addressed container registry, in JavaScript:
// blobs are named by the hash of their bytes (so identical layers are stored once), uploads can resume at an offset,
// tags point at manifests, and garbage collection sweeps unreferenced blobs but spares ones that are still being pushed.

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const digest = (s) => 'fnv1a:' + fnv(s).toString(16).padStart(8, '0'); // a stand-in for sha256, so all three languages print the same

class Registry {
  constructor() { this.blobs = new Map(); this.tags = new Map(); this.uploads = new Map(); this.clock = 0; this.nextId = 1; this.deduped = 0; }

  head(d) { const b = this.blobs.get(d); if (b) { b.born = ++this.clock; this.deduped++; } return !!b; } // "do you have it?" also refreshes its age
  startUpload() { const id = this.nextId++; this.uploads.set(id, ''); return id; }
  offset(id) { return this.uploads.get(id).length; }
  patch(id, offset, chunk) { // a chunk is accepted only at the offset the server expects, so a retry cannot corrupt the upload
    if (offset !== this.offset(id)) return -1;
    this.uploads.set(id, this.uploads.get(id) + chunk);
    return this.offset(id);
  }
  finish(id, want) { // the server recomputes the digest; it never trusts the client's claim
    const data = this.uploads.get(id); this.uploads.delete(id);
    if (digest(data) !== want) return false;
    this.blobs.set(want, { data, born: ++this.clock });
    return true;
  }
  put(data) { const id = this.startUpload(); this.patch(id, 0, data); return this.finish(id, digest(data)); }

  putManifest(ref, layers) { // a manifest may only name blobs that already exist
    const missing = layers.find((d) => !this.blobs.has(d));
    if (missing) return 'rejected: unknown ' + missing;
    const text = layers.join('\n'); const d = digest(text);
    this.blobs.set(d, { data: text, born: ++this.clock }); this.tags.set(ref, d);
    return d;
  }

  gc(grace) { // mark everything reachable from a tag, then sweep blobs that are unmarked and older than the grace period
    const marked = new Set();
    for (const m of this.tags.values()) { marked.add(m); this.blobs.get(m).data.split('\n').forEach((d) => marked.add(d)); }
    let swept = 0, bytes = 0;
    for (const [d, b] of [...this.blobs]) {
      if (marked.has(d) || b.born > this.clock - grace) continue;
      this.blobs.delete(d); swept++; bytes += b.data.length;
    }
    return { swept, bytes };
  }
  size() { let n = 0; for (const b of this.blobs.values()) n += b.data.length; return n; }
}

const SEED = 7, IMAGES = 30, BASE_LAYERS = 6, RUNTIME_LAYERS = 4, RETIRED = 10;
const BASE_SIZE = 600, BASE_SIZE_STEP = 100, RUNTIME_SIZE = 300, APP_MIN_SIZE = 100, APP_SIZE_SPREAD = 100; // bytes
const BIG_SIZE = 650, CHUNK = 200; // the resumable upload sends 200-byte chunks
const MIN_DEDUPED = 20; // shared layers must save at least this many uploads
let seed = SEED;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const layer = (name, size) => name + ':' + 'x'.repeat(size - name.length - 1);

const reg = new Registry();
let logical = 0;
const push = (ref, texts) => { // upload only what is missing, then publish the manifest
  const ds = texts.map((t) => { logical += t.length; const d = digest(t); if (!reg.head(d)) reg.put(t); return d; });
  return reg.putManifest(ref, ds);
};
for (let i = 0; i < IMAGES; i++) { // 30 images share 6 base layers and 4 runtime layers, and each has its own app layer
  const base = rnd(BASE_LAYERS), mid = rnd(RUNTIME_LAYERS);
  push(`app${i}:v1`, [layer('base' + base, BASE_SIZE + BASE_SIZE_STEP * base), layer('rt' + mid, RUNTIME_SIZE), layer('app' + i, APP_MIN_SIZE + rnd(APP_SIZE_SPREAD))]);
}
const blobCount = reg.blobs.size;
console.log(`30 images, logical ${logical} bytes, stored ${reg.size()} bytes in ${blobCount} blobs, ${reg.deduped} uploads skipped`);

const big = layer('big', BIG_SIZE), want = digest(big), id = reg.startUpload();
reg.patch(id, 0, big.slice(0, CHUNK)); reg.patch(id, CHUNK, big.slice(CHUNK, 2 * CHUNK));
console.log(`stale retry at offset 200: ${reg.patch(id, CHUNK, big.slice(CHUNK, 2 * CHUNK))}; server says resume at ${reg.offset(id)}`);
reg.patch(id, reg.offset(id), big.slice(2 * CHUNK));
console.log(`resumed upload verified: ${reg.finish(id, want)}`);

for (let i = 0; i < RETIRED; i++) reg.tags.delete(`app${i}:v1`); // retire ten images
const live = reg.gc(0);
console.log(`gc after untagging 10 images: swept ${live.swept} blobs, freed ${live.bytes} bytes, ${reg.blobs.size} blobs left`);
for (const m of reg.tags.values()) for (const d of reg.blobs.get(m).data.split('\n')) if (!reg.blobs.has(d)) { console.log('BROKEN IMAGE'); process.exit(1); }

const racy = new Registry(), r2 = new Registry();
for (const [r, grace] of [[racy, 0], [r2, 5]]) {
  const t = layer('late', 200), d = digest(t);
  r.put(t);                        // the client has uploaded its layer but not yet its manifest
  r.gc(grace);                     // a collection runs in between
  console.log(`grace ${grace}: manifest commit -> ${r.putManifest('late:v1', [d]).startsWith('rejected') ? 'rejected, layer was swept' : 'ok'}`);
}
if (reg.deduped < MIN_DEDUPED || reg.size() >= logical || live.swept === 0) process.exit(1);
