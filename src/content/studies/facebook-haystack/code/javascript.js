// A miniature of Haystack from Facebook's "Needle in a haystack: efficient storage of billions of photos" (2009), in JavaScript
// (a teaching model, not Facebook's code): photos are needles appended to one big store file, an in-memory index maps a photo and
// size to the needle's offset so a read costs one disk I/O, a delete only sets a flag, compaction copies the live needles into
// a new store, and a restarted server rebuilds its index from the store. Everything is deterministic.

const SIZES = { large: 100, medium: 40, small: 20, thumb: 8 }; // bytes of image data per size (made up)
const HEADER = 16, FOOTER = 8; // bytes of needle overhead (made up)
let store = []; // the append-only store file: needles in the order they were written
let index = new Map(); // in memory: "photo/size" -> offset of the needle in the store file
let bytes = 0, diskReads = 0;

function put(photo, size) {
  const needle = { photo, size, length: SIZES[size], deleted: false, offset: bytes };
  bytes += HEADER + needle.length + FOOTER;
  store.push(needle);
  index.set(`${photo}/${size}`, needle.offset);
}
function read(photo, size) {
  const offset = index.get(`${photo}/${size}`);
  if (offset === undefined) return `photo ${photo} ${size}: not found (the index answered, no disk read)`;
  diskReads++; // one read of the needle at a known offset
  const needle = store.find((n) => n.offset === offset);
  return `photo ${photo} ${size}: ${needle.length} bytes from offset ${offset} (1 disk read)`;
}
const nfsReads = 3; // directory lookup, inode read and data read when the metadata is not cached (a simple assumption)

for (const photo of [1, 2, 3]) for (const size of Object.keys(SIZES)) put(photo, size);
console.log(`uploaded 3 photos in 4 sizes: ${store.length} needles, store file ${bytes} bytes, index entries ${index.size}`);
console.log(read(2, 'medium'));
console.log(`without an in-memory index a file-per-photo layout needs about ${nfsReads} disk reads for the same photo`);
for (let i = 0; i < 100; i++) read(3, 'thumb');
console.log(`100 thumbnail reads: ${diskReads - 1} disk reads, against about ${100 * nfsReads} in the file-per-photo layout`);

for (const size of Object.keys(SIZES)) { // delete photo 2: set the flag and drop it from the index; the bytes stay in the file
  store.filter((n) => n.photo === 2 && n.size === size).forEach((n) => (n.deleted = true));
  index.delete(`2/${size}`);
}
console.log(read(2, 'medium'));
console.log(`after the delete the store file is still ${bytes} bytes, with ${store.filter((n) => n.deleted).length} flagged needles`);

index = new Map();
for (const n of store) if (!n.deleted) index.set(`${n.photo}/${n.size}`, n.offset); // after a restart the index is rebuilt from the store
console.log(`restart: index rebuilt from the store file with ${index.size} live entries`);

const live = store.filter((n) => !n.deleted);
store = []; bytes = 0; index = new Map();
live.forEach((n) => put(n.photo, n.size)); // compaction: copy live needles into a new store file
console.log(`compaction: new store file ${bytes} bytes with ${store.length} needles`);
console.log(read(3, 'thumb'));
