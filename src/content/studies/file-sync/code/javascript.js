// Syncing a file by chunks in JavaScript:
// the file is cut where its own content says so, each chunk is stored under its hash, and only chunks the server lacks are uploaded.
import { createHash } from 'node:crypto';

const MIN = 1024, AVG_BITS = 12, MAX = 16384; // chunks average about 4 KB (2^12 bytes), and are never under 1 KB or over 16 KB
const FIXED = 4096;

let seed = 7; // a small repeatable random generator, so every run sees the same file
const nextRandom = () => (seed = (seed * 1664525 + 1013904223) % 4294967296);
const GEAR = Array.from({ length: 256 }, () => nextRandom()); // a random number for each possible byte value
const randomBytes = (n) => Uint8Array.from({ length: n }, () => (nextRandom() >>> 16) & 255);

// Content-defined chunking: roll a hash along the bytes and end a chunk when its top bits are all zero.
// The cut points depend on the last few dozen bytes only, so they move with the content when something is inserted before them.
function chunkByContent(data) {
  const mask = ((1 << AVG_BITS) - 1) << (32 - AVG_BITS);
  const chunks = []; let start = 0, h = 0;
  for (let i = 0; i < data.length; i++) {
    h = ((h << 1) + GEAR[data[i]]) >>> 0;
    const size = i - start + 1;
    if ((size >= MIN && (h & mask) === 0) || size >= MAX) { chunks.push(data.subarray(start, i + 1)); start = i + 1; h = 0; }
  }
  if (start < data.length) chunks.push(data.subarray(start));
  return chunks;
}

function chunkFixed(data) {
  const chunks = [];
  for (let i = 0; i < data.length; i += FIXED) chunks.push(data.subarray(i, i + FIXED));
  return chunks;
}

const hashOf = (chunk) => createHash('sha256').update(chunk).digest('hex');

// The server keeps every chunk it has seen, by hash. Uploading a file means sending only the chunks it does not hold yet.
function sync(server, chunks) {
  let sent = 0;
  for (const chunk of chunks) {
    const key = hashOf(chunk);
    if (!server.has(key)) { server.set(key, chunk.length); sent += chunk.length; }
  }
  return sent;
}

const original = randomBytes(300000);
const edited = new Uint8Array(original.length + 10);
edited.set(randomBytes(10), 0); edited.set(original, 10); // 10 bytes inserted at the very start

let failures = 0;
for (const [name, chunker, limit] of [['fixed 4 KB chunks', chunkFixed, 'high'], ['content-defined chunks', chunkByContent, 'low']]) {
  const server = new Map();
  const first = sync(server, chunker(original));
  const second = sync(server, chunker(edited));
  const share = (second / edited.length) * 100;
  console.log(`${name}: first upload ${first} bytes, after inserting 10 bytes at the start ${second} bytes (${share.toFixed(1)}% of the file)`);
  if (limit === 'high' && share < 90) failures++; // fixed chunks: every boundary moved, so nearly everything is sent again
  if (limit === 'low' && share > 10) failures++; // content-defined: only the chunk around the edit is sent
}
if (failures) process.exit(1);
