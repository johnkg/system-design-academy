# A tiny secrets vault in Python: Shamir-split master key, envelope encryption, policies with audit, master rotation, and leases.
# The cipher is a toy (XOR with a seeded stream) so the example stays short and deterministic. Never use it for real secrets.
import sys

SEED = 7
KEY_BYTES = 16  # 128-bit master and data keys
SHARES, THRESHOLD = 5, 3  # any 3 of 5 key holders can unseal
LEASE_TTL, MAX_TTL = 60, 120  # seconds
state = SEED  # seeded generator, so every run prints the same thing


def next_value():
    global state
    state = (state * 1664525 + 1013904223) % 4294967296
    return state


def rnd(n):
    return (next_value() // 65536) % n


def random_bytes(n):
    return [rnd(256) for _ in range(n)]


def hex_of(data):
    return "".join(format(b, "02x") for b in data)


def to_bytes(text):
    return [ord(c) for c in text]


def to_text(data):
    return "".join(chr(b) for b in data)


P = 257  # a prime just above 255, so each byte of the key is one number in the field


def inv(a):
    r, b, e = 1, a % P, P - 2
    while e:
        if e & 1:
            r = (r * b) % P
        b = (b * b) % P
        e >>= 1
    return r


def split(secret, n, k):
    """Shamir: every byte is the constant term of a random polynomial of degree k-1; share x is its value at x."""
    shares = [{"x": i + 1, "ys": []} for i in range(n)]
    for byte in secret:
        coef = [byte] + [rnd(P) for _ in range(k - 1)]
        for s in shares:
            acc = 0
            for c in reversed(coef):
                acc = (acc * s["x"] + c) % P
            s["ys"].append(acc)
    return shares


def combine(shares):
    """Lagrange interpolation at x = 0."""
    out = []
    for t in range(len(shares[0]["ys"])):
        total = 0
        for a in shares:
            num, den = 1, 1
            for b in shares:
                if b is not a:
                    num = (num * b["x"]) % P
                    den = (den * (b["x"] - a["x"] + P)) % P
            total = (total + a["ys"][t] * num * inv(den)) % P
        out.append(total % 256)  # values above 255 only appear for wrong shares
    return out


def cipher(data, key, nonce):
    """XOR with the key and a stream from the nonce, so the same call encrypts and decrypts."""
    s = nonce
    out = []
    for i, d in enumerate(data):
        s = (s * 1664525 + 1013904223) % 4294967296
        out.append(d ^ key[i % len(key)] ^ ((s >> 16) & 255))
    return out


class Vault:
    def __init__(self, policies):
        self.master = None
        self.store = {}
        self.audit = []
        self.policies = policies
        self.leases = []
        self.issued = 0

    def unseal(self, shares):
        self.master = combine(shares)

    def put(self, path, text):  # envelope: a fresh data key encrypts the secret, the master key only wraps it
        dek, nonce_w, nonce_c = random_bytes(KEY_BYTES), next_value(), next_value()
        self.store[path] = {"wrapped": cipher(dek, self.master, nonce_w), "nonce_w": nonce_w,
                            "ct": cipher(to_bytes(text), dek, nonce_c), "nonce_c": nonce_c}

    def read(self, token, path):  # every read is logged, allowed or not
        allowed = self.master is not None and any(path.startswith(p) for p in self.policies.get(token, []))
        self.audit.append(f"{token} {path} {'ok' if allowed else 'denied'}")
        if not allowed:
            return None
        e = self.store[path]
        return to_text(cipher(e["ct"], cipher(e["wrapped"], self.master, e["nonce_w"]), e["nonce_c"]))

    def rotate_master(self):  # rewrap each data key under a new master; the stored secrets are not touched
        fresh = random_bytes(KEY_BYTES)
        for e in self.store.values():
            dek = cipher(e["wrapped"], self.master, e["nonce_w"])
            e["nonce_w"] = next_value()
            e["wrapped"] = cipher(dek, fresh, e["nonce_w"])
        self.master = fresh

    def issue(self, now, ttl, max_ttl):
        self.issued += 1
        lease = {"user": f"u-{self.issued}", "start": now, "expires": now + ttl, "max_ttl": max_ttl}
        self.leases.append(lease)
        return lease

    def renew(self, lease, now, ttl):
        lease["expires"] = min(now + ttl, lease["start"] + lease["max_ttl"])

    def sweep(self, now):
        dead = [l for l in self.leases if l["expires"] <= now]
        self.leases = [l for l in self.leases if l["expires"] > now]
        return [l["user"] for l in dead]


def all_ct(vault):
    return hex_of([b for e in vault.store.values() for b in e["ct"]])


def lower(flag):
    return "true" if flag else "false"


master0 = random_bytes(KEY_BYTES)
shares = split(master0, SHARES, THRESHOLD)
print("share 1 starts with " + ",".join(str(v) for v in shares[0]["ys"][:4]))
all_equal = True
for i in range(SHARES):
    for j in range(i + 1, SHARES):
        for k in range(j + 1, SHARES):
            all_equal = all_equal and hex_of(combine([shares[i], shares[j], shares[k]])) == hex_of(master0)
two_work = hex_of(combine([shares[0], shares[1]])) == hex_of(master0)
print(f"any 3 of 5 shares rebuild the master key: {lower(all_equal)}; 2 shares do: {lower(two_work)}")

vault = Vault({"web": ["db/web"], "billing": ["db/billing"]})
vault.unseal([shares[0], shares[2], shares[4]])
vault.put("db/web", "p4ss-web")
vault.put("db/billing", "p4ss-billing")
vault.put("api/stripe", "sk_live_1")
before = all_ct(vault)
reads = [vault.read(t, p) for t, p in [("web", "db/web"), ("web", "db/billing"), ("billing", "db/billing"), ("web", "api/stripe")]]
print("reads: " + " | ".join("denied" if r is None else r for r in reads))
vault.rotate_master()
keys_changed = hex_of(vault.master) != hex_of(master0)
after_ok = vault.read("web", "db/web") == "p4ss-web" and before == all_ct(vault)
print(f"master rotated: {lower(keys_changed)}; 3 data keys rewrapped, stored ciphertext unchanged and readable: {lower(after_ok)}")
print(f"audit has {len(vault.audit)} lines, last: {vault.audit[-1]}")

a = vault.issue(0, LEASE_TTL, MAX_TTL)
b = vault.issue(10, LEASE_TTL, MAX_TTL)
vault.renew(a, 50, LEASE_TTL)  # a would reach 110
gone75 = vault.sweep(75)
vault.renew(a, 100, LEASE_TTL)  # capped at start + max_ttl = 120
gone130 = vault.sweep(130)
print(f"leases: revoked {','.join(gone75)} at t=75, {','.join(gone130)} at t=130 (expiry capped at {a['expires']})")

if (not all_equal or two_work or not after_ok or not keys_changed or len(vault.audit) != 5 or reads[1] is not None
        or reads[3] is not None or a["expires"] != 120 or gone75 != ["u-2"] or gone130 != ["u-1"] or vault.leases):
    sys.exit(1)
