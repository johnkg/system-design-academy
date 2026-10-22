# Envelope encryption with a key management service, in Python.
# WARNING: the cipher below (FNV-1a hashing and an LCG keystream XOR) is a TOY to show the structure. It is NOT real cryptography.
# Shape: root key (the "HSM") wraps key versions, a key version wraps data keys, a data key encrypts the data.
import sys

M = 0xFFFFFFFF
SEED = 7
DELETION_WAIT_DAYS = 7  # a key scheduled for deletion can still be cancelled for a week
seed = SEED
def rng():
    global seed
    seed = (seed * 1664525 + 1013904223) & M
    return seed
def fnv(key, data):
    h = (2166136261 ^ key) & M
    for b in data: h = ((h ^ b) * 16777619) & M
    return h
def xor(key, nonce, data):
    s, out = (key ^ nonce) & M, []
    for b in data:
        s = (s * 1664525 + 1013904223) & M
        out.append(b ^ (s >> 24))
    return out
word = lambda n: [n >> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
unword = lambda b: (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]
to_bytes = lambda s: [ord(c) for c in s]
to_text = lambda b: "".join(chr(c) for c in b)
class Kms:
    def __init__(self, root_key):
        self.root_mask, self.keys, self.day, self.audit, self.chain = fnv(root_key, [1]), {}, 0, [], 0
    def log(self, who, action, key_id, outcome):  # append-only log; each entry is chained to the one before
        line = f"{len(self.audit) + 1} day{self.day} {who} {action} {key_id} {outcome}"
        self.audit.append(line)
        self.chain = fnv(self.chain, to_bytes(line))
    def verify(self):
        c = 0
        for line in self.audit: c = fnv(c, to_bytes(line))
        return c == self.chain
    def run(self, who, action, key_id, fn):  # policy check, the operation, and an audit entry for every outcome
        k = self.keys.get(key_id)
        if k is None or who not in k["policy"].get(action, []):
            self.log(who, action, key_id, "DENIED")
            raise RuntimeError("denied")
        try:
            r = fn(k)
        except RuntimeError as e:
            self.log(who, action, key_id, "FAILED " + str(e))
            raise
        self.log(who, action, key_id, "OK")
        return r
    def add_version(self, k):  # key material is stored only wrapped by the root key
        k["wrapped"].append(rng() ^ self.root_mask)
    def kek(self, k, v):
        if v > len(k["wrapped"]): raise RuntimeError("unknown version")
        return (k["wrapped"][v - 1] ^ self.root_mask) & M
    def usable(self, k):
        if k["state"] != "enabled": raise RuntimeError("pending deletion" if k["state"] == "pending" else "destroyed")
    def create(self, who, key_id, policy):
        self.keys[key_id] = {"policy": policy, "wrapped": [], "state": "enabled", "delete_at": 0}
        self.add_version(self.keys[key_id])
        self.log(who, "create", key_id, "OK")
    def seal(self, k, dk):
        v, nonce = len(k["wrapped"]), rng()
        ct = xor(self.kek(k, v), nonce, word(dk))
        return {"v": v, "nonce": nonce, "ct": ct, "mac": fnv(self.kek(k, v) ^ nonce, ct)}
    def open(self, k, b):
        kek = self.kek(k, b["v"])
        if fnv(kek ^ b["nonce"], b["ct"]) != b["mac"]: raise RuntimeError("bad mac")
        return unword(xor(kek, b["nonce"], b["ct"]))
    def guarded(self, who, action, key_id, fn):  # an operation that needs a usable key
        return self.run(who, action, key_id, lambda k: (self.usable(k), fn(k))[1])
    def generate_data_key(self, who, key_id):
        return self.guarded(who, "encrypt", key_id, lambda k: self.new_data_key(k))
    def new_data_key(self, k):
        dk = rng()
        return {"dk": dk, "blob": self.seal(k, dk)}
    def decrypt(self, who, key_id, blob):
        return self.guarded(who, "decrypt", key_id, lambda k: self.open(k, blob))
    def rewrap(self, who, key_id, blob):  # the data key never leaves the service
        return self.guarded(who, "rewrap", key_id, lambda k: self.seal(k, self.open(k, blob)))
    def rotate(self, who, key_id):
        self.run(who, "admin", key_id, self.add_version)
    def set_state(self, who, key_id, state, days=0):
        self.run(who, "admin", key_id, lambda k: k.update(state=state, delete_at=self.day + days))
    def advance(self, days):
        self.day += days
        for key_id, k in self.keys.items():
            if k["state"] == "pending" and self.day >= k["delete_at"]:
                k["state"], k["wrapped"] = "destroyed", []
                self.log("system", "destroy", key_id, "OK")
def put(kms, who, key_id, plain):
    g, nonce = kms.generate_data_key(who, key_id), rng()
    return {"blob": g["blob"], "nonce": nonce, "ct": xor(g["dk"], nonce, to_bytes(plain))}
def get(kms, who, key_id, rec):
    return to_text(xor(kms.decrypt(who, key_id, rec["blob"]), rec["nonce"], rec["ct"]))
def attempt(fn):
    try: return "ok " + str(fn())
    except RuntimeError as e: return "error " + str(e)
versions = lambda docs: ",".join(str(d["blob"]["v"]) for d in docs)
count = lambda w: sum(1 for line in kms.audit if w in line)
low = lambda b: str(b).lower()
kms = Kms(0x5EED1234)
kms.create("secops", "orders", {"encrypt": ["app", "batch"], "decrypt": ["app"], "rewrap": ["batch"], "admin": ["secops"]})
docs = [put(kms, "app", "orders", t) for t in ["card:4111-0001", "card:4111-0002", "card:4111-0003"]]
print(f"3 objects encrypted, blob versions: {versions(docs)}, first ciphertext {''.join(f'{b:02x}' for b in docs[0]['ct'])}")
kms.rotate("secops", "orders")
docs.append(put(kms, "app", "orders", "card:4111-0004"))
print(f"after rotation, blob versions: {versions(docs)}, old object still reads: {get(kms, 'app', 'orders', docs[0])}")
moved = [{**d, "blob": kms.rewrap("batch", "orders", d["blob"])} for d in docs]
same = all(m["ct"] == d["ct"] for m, d in zip(moved, docs))
print(f"rewrapped, blob versions: {versions(moved)}, data ciphertext untouched: {low(same)}")
print(f"batch decrypt: {attempt(lambda: get(kms, 'batch', 'orders', moved[0]))}; mallory encrypt: {attempt(lambda: kms.generate_data_key('mallory', 'orders'))}")
kms.set_state("secops", "orders", "pending", DELETION_WAIT_DAYS)
print(f"during the wait: {attempt(lambda: get(kms, 'app', 'orders', moved[1]))}")
kms.set_state("secops", "orders", "enabled")
print(f"after cancel: {attempt(lambda: get(kms, 'app', 'orders', moved[1]))}")
kms.advance(3)
kms.set_state("secops", "orders", "pending", DELETION_WAIT_DAYS)
kms.advance(DELETION_WAIT_DAYS - 1)
print(f"day {kms.day}, still waiting: {attempt(lambda: get(kms, 'app', 'orders', moved[2]))}")
kms.advance(1)
print(f"day {kms.day}, deleted: {attempt(lambda: get(kms, 'app', 'orders', moved[2]))}")
print(f"audit: {len(kms.audit)} entries, {count(' OK')} ok, {count('DENIED')} denied, {count('FAILED')} failed, chain {kms.chain:08x}, intact {low(kms.verify())}")
forged = kms.audit[:]
kms.audit[3] = kms.audit[3].replace("OK", "DENIED")
print(f"after editing one entry, chain intact: {low(kms.verify())}")
kms.audit = forged
if versions(docs) != "1,1,1,2" or count("DENIED") != 2 or not kms.verify():
    sys.exit(1)
