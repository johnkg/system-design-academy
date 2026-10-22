# Syncing a file by chunks in Python:
# the file is cut where its own content says so, each chunk is stored under its hash, and only chunks the server lacks are uploaded.
import hashlib
import sys

MIN, AVG_BITS, MAX = 1024, 12, 16384  # chunks average about 4 KB (2^12 bytes), and are never under 1 KB or over 16 KB
FIXED = 4096

SEED, FILE_BYTES, INSERTED = 7, 300000, 10
MIN_RESENT_FIXED, MAX_RESENT_CDC = 90, 10  # percent of the file sent again after the edit
seed = SEED  # a small repeatable random generator, so every run sees the same file


def next_random():
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed


GEAR = [next_random() for _ in range(256)]  # a random number for each possible byte value


def random_bytes(n):
    return bytes((next_random() >> 16) & 255 for _ in range(n))


# Content-defined chunking: roll a hash along the bytes and end a chunk when its top bits are all zero.
# The cut points depend on the last few dozen bytes only, so they move with the content when something is inserted before them.
def chunk_by_content(data):
    mask = ((1 << AVG_BITS) - 1) << (32 - AVG_BITS)
    chunks = []
    start = h = 0
    for i, byte in enumerate(data):
        h = ((h << 1) + GEAR[byte]) & 0xFFFFFFFF
        size = i - start + 1
        if (size >= MIN and (h & mask) == 0) or size >= MAX:
            chunks.append(data[start:i + 1])
            start = i + 1
            h = 0
    if start < len(data):
        chunks.append(data[start:])
    return chunks


def chunk_fixed(data):
    return [data[i:i + FIXED] for i in range(0, len(data), FIXED)]


def hash_of(chunk):
    return hashlib.sha256(chunk).hexdigest()


# The server keeps every chunk it has seen, by hash. Uploading a file means sending only the chunks it does not hold yet.
def sync(server, chunks):
    sent = 0
    for chunk in chunks:
        key = hash_of(chunk)
        if key not in server:
            server[key] = len(chunk)
            sent += len(chunk)
    return sent


original = random_bytes(FILE_BYTES)
edited = random_bytes(INSERTED) + original  # 10 bytes inserted at the very start

failures = 0
for name, chunker, limit in [("fixed 4 KB chunks", chunk_fixed, "high"), ("content-defined chunks", chunk_by_content, "low")]:
    server = {}
    first = sync(server, chunker(original))
    second = sync(server, chunker(edited))
    share = (second / len(edited)) * 100
    print(f"{name}: first upload {first} bytes, after inserting 10 bytes at the start {second} bytes ({share:.1f}% of the file)")
    if limit == "high" and share < MIN_RESENT_FIXED:
        failures += 1  # fixed chunks: every boundary moved, so nearly everything is sent again
    if limit == "low" and share > MAX_RESENT_CDC:
        failures += 1  # content-defined: only the chunk around the edit is sent
if failures:
    sys.exit(1)
