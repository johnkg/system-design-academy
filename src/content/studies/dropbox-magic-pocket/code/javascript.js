// A miniature of the technique behind Dropbox's Magic Pocket, in JavaScript (a teaching model, not Dropbox's code):
// blocks named by a hash go into append-only volumes, a full volume is closed, a closed volume is re-encoded from
// three copies to three data shards plus one XOR parity shard, a read rebuilds a lost shard from the others,
// and repair commits its new layout by raising a generation number.
// Everything is deterministic, so every run prints the same thing.

const SLOT = 16; // bytes in one block slot (real blocks are up to 4 MB)
const K = 3; // data slots per volume; a volume closes when they are full
const NODES = 6; // storage nodes in the toy cell
const COPIES = 3; // replicas of a volume while it is young

// Stand-in for the SHA-256 name of a block: 32-bit FNV-1a, printed as 8 hex digits.
function nameOf(text) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const xor = (a, b) => a.map((x, i) => x ^ b[i]);
const xorAll = (list) => list.reduce(xor);
const text = (bytes, len) => Buffer.from(bytes.slice(0, len)).toString();

const index = new Map(); // block name -> { vol, slot, len, deleted }
const volumes = []; // { id, open, slots, mode, nodes, shards, generation }

function put(content) {
  const name = nameOf(content);
  const known = index.get(name);
  if (known && !known.deleted) { console.log(`put ${content.padEnd(12)} ${name} already stored, nothing written`); return; }
  let vol = volumes[volumes.length - 1];
  if (!vol || !vol.open) {
    vol = { id: volumes.length, open: true, slots: [], mode: 'replicated', nodes: [0, 1, 2].map((i) => (volumes.length + i) % NODES), shards: null, generation: 0 };
    volumes.push(vol);
  }
  const bytes = [...Buffer.from(content)];
  vol.slots.push(bytes.concat(Array(SLOT - bytes.length).fill(0))); // append only: slots are never rewritten
  index.set(name, { vol: vol.id, slot: vol.slots.length - 1, len: bytes.length, deleted: false });
  let line = `put ${content.padEnd(12)} ${name} volume ${vol.id} slot ${vol.slots.length - 1}`;
  if (vol.slots.length === K) { vol.open = false; line += ', volume full and closed'; }
  console.log(line);
}

// Cool a closed volume: three full copies become K data shards and one parity shard on different nodes.
function encode(vol) {
  const before = COPIES * K * SLOT;
  vol.shards = [...vol.slots, xorAll(vol.slots)];
  vol.nodes = [0, 1, 2, 3].map((i) => (vol.id + i) % NODES);
  vol.mode = 'encoded';
  vol.generation++;
  console.log(`volume ${vol.id} encoded: ${before} bytes as ${COPIES} copies, ${vol.shards.length * SLOT} bytes as ${K}+1 shards on nodes ${vol.nodes.join(',')}, generation ${vol.generation}`);
}

function read(name, down) {
  const e = index.get(name);
  const vol = volumes[e.vol];
  const live = (n) => n !== down;
  if (vol.mode === 'replicated') {
    const node = vol.nodes.find(live);
    return { data: text(vol.slots[e.slot], e.len), how: `replica on node ${node}` };
  }
  if (live(vol.nodes[e.slot])) return { data: text(vol.shards[e.slot], e.len), how: `shard ${e.slot} on node ${vol.nodes[e.slot]}` };
  const others = vol.shards.filter((_, i) => i !== e.slot && live(vol.nodes[i]));
  return { data: text(xorAll(others), e.len), how: `shard ${e.slot} lost, rebuilt from ${others.length} other shards` };
}

// The coordinator's repair: only a closed volume is moved, and the move commits by raising the generation.
function repair(vol, down) {
  const lost = vol.nodes.indexOf(down);
  const spare = [...Array(NODES).keys()].find((n) => !vol.nodes.includes(n));
  vol.shards[lost] = xorAll(vol.shards.filter((_, i) => i !== lost));
  vol.nodes[lost] = spare;
  vol.generation++;
  console.log(`repair volume ${vol.id}: shard ${lost} rebuilt on node ${spare}, generation now ${vol.generation}`);
}

for (const c of ['report-v1', 'photo-001', 'report-v1', 'notes-draft', 'invoice-0316', 'tax-1997']) put(c);
console.log(`open volumes: ${volumes.filter((v) => v.open).map((v) => v.id).join(',')}`);

encode(volumes[0]);
const photo = nameOf('photo-001');
let r = read(photo, -1);
console.log(`read photo-001: "${r.data}" via ${r.how}`);

const DOWN = volumes[0].nodes[index.get(photo).slot];
console.log(`node ${DOWN} stops answering`);
r = read(photo, DOWN);
console.log(`read photo-001: "${r.data}" via ${r.how}`);
repair(volumes[0], DOWN);
console.log(`node ${DOWN} comes back with generation ${volumes[0].generation - 1} of volume 0; the table says ${volumes[0].generation}, so its shard is ignored`);

index.get(nameOf('notes-draft')).deleted = true;
console.log('deleted notes-draft: volume 0 is unchanged, 2 of 3 slots are live, compaction will reclaim the rest');

const ok = r.data === 'photo-001' && volumes[0].generation === 2;
console.log(`blocks ${index.size}, volumes ${volumes.length}, checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
