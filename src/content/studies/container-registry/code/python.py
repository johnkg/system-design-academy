# A content-addressed container registry, in Python:
# blobs are named by the hash of their bytes (so identical layers are stored once), uploads can resume at an offset,
# tags point at manifests, and garbage collection sweeps unreferenced blobs but spares ones that are still being pushed.
import sys

def fnv(s):
    h = 0x811C9DC5
    for ch in s:
        h = ((h ^ ord(ch)) * 0x01000193) & 0xFFFFFFFF
    return h

def digest(s):  # a stand-in for sha256, so all three languages print the same
    return 'fnv1a:' + format(fnv(s), '08x')

class Registry:
    def __init__(self):
        self.blobs, self.tags, self.uploads = {}, {}, {}
        self.clock, self.next_id, self.deduped = 0, 0, 0
    def tick(self):
        self.clock += 1
        return self.clock
    def head(self, d):  # "do you have it?" also refreshes its age
        if d in self.blobs:
            self.blobs[d]['born'] = self.tick()
            self.deduped += 1
        return d in self.blobs
    def start_upload(self):
        self.next_id += 1
        self.uploads[self.next_id] = ''
        return self.next_id
    def offset(self, uid):
        return len(self.uploads[uid])
    def patch(self, uid, offset, chunk):  # a chunk is accepted only at the offset the server expects, so a retry cannot corrupt the upload
        if offset != self.offset(uid):
            return -1
        self.uploads[uid] += chunk
        return self.offset(uid)
    def finish(self, uid, want):  # the server recomputes the digest; it never trusts the client's claim
        data = self.uploads.pop(uid)
        if digest(data) == want:
            self.blobs[want] = {'data': data, 'born': self.tick()}
        return digest(data) == want
    def put(self, data):
        uid = self.start_upload()
        self.patch(uid, 0, data)
        return self.finish(uid, digest(data))
    def put_manifest(self, ref, layers):  # a manifest may only name blobs that already exist
        missing = [d for d in layers if d not in self.blobs]
        if missing:
            return 'rejected: unknown ' + missing[0]
        text = '\n'.join(layers)
        d = digest(text)
        self.blobs[d] = {'data': text, 'born': self.tick()}
        self.tags[ref] = d
        return d
    def gc(self, grace):  # mark everything reachable from a tag, then sweep blobs that are unmarked and older than the grace period
        marked = set(self.tags.values())
        for m in self.tags.values():
            marked.update(self.blobs[m]['data'].split('\n'))
        dead = [d for d, b in self.blobs.items() if d not in marked and b['born'] <= self.clock - grace]
        freed = sum(len(self.blobs.pop(d)['data']) for d in dead)
        return len(dead), freed
    def size(self):
        return sum(len(b['data']) for b in self.blobs.values())


seed = 7


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n

def layer(name, size):
    return name + ':' + 'x' * (size - len(name) - 1)

reg = Registry()
logical = 0
for i in range(30):  # 30 images share 6 base layers and 4 runtime layers, and each has its own app layer
    base, mid = rnd(6), rnd(4)
    texts = [layer('base%d' % base, 600 + 100 * base), layer('rt%d' % mid, 300), layer('app%d' % i, 100 + rnd(100))]
    for t in texts:  # push: upload only what is missing, then publish the manifest
        logical += len(t)
        if not reg.head(digest(t)):
            reg.put(t)
    reg.put_manifest('app%d:v1' % i, [digest(t) for t in texts])
print('30 images, logical %d bytes, stored %d bytes in %d blobs, %d uploads skipped' % (logical, reg.size(), len(reg.blobs), reg.deduped))

big = layer('big', 650)
uid = reg.start_upload()
reg.patch(uid, 0, big[:200])
reg.patch(uid, 200, big[200:400])
print('stale retry at offset 200: %d; server says resume at %d' % (reg.patch(uid, 200, big[200:400]), reg.offset(uid)))
reg.patch(uid, reg.offset(uid), big[400:])
print('resumed upload verified: %s' % str(reg.finish(uid, digest(big))).lower())

for i in range(10):  # retire ten images
    del reg.tags['app%d:v1' % i]
swept, freed = reg.gc(0)
print('gc after untagging 10 images: swept %d blobs, freed %d bytes, %d blobs left' % (swept, freed, len(reg.blobs)))
broken = [d for m in reg.tags.values() for d in reg.blobs[m]['data'].split('\n') if d not in reg.blobs]
if broken:
    sys.exit('BROKEN IMAGE')

for grace in (0, 5):
    r = Registry()
    t = layer('late', 200)
    r.put(t)  # the client has uploaded its layer but not yet its manifest
    r.gc(grace)  # a collection runs in between
    ok = not r.put_manifest('late:v1', [digest(t)]).startswith('rejected')
    print('grace %d: manifest commit -> %s' % (grace, 'ok' if ok else 'rejected, layer was swept'))
if reg.deduped < 20 or reg.size() >= logical or swept == 0:
    sys.exit(1)
