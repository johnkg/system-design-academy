// A tiny secrets vault in JavaScript: Shamir-split master key, envelope encryption, policies with audit, master rotation, and leases.
// The cipher is a toy (XOR with a seeded stream) so the example stays short and deterministic. Never use it for real secrets.

const SEED = 7;
const KEY_BYTES = 16; // 128-bit master and data keys
const SHARES = 5, THRESHOLD = 3; // any 3 of 5 key holders can unseal
const LEASE_TTL = 60, MAX_TTL = 120; // seconds
let state = SEED; // seeded generator, so every run prints the same thing
const next = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state; };
const rnd = (n) => Math.floor(next() / 65536) % n;
const randomBytes = (n) => Array.from({ length: n }, () => rnd(256));
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
const toBytes = (text) => [...text].map((c) => c.charCodeAt(0));
const toText = (bytes) => bytes.map((b) => String.fromCharCode(b)).join('');

const P = 257; // a prime just above 255, so each byte of the key is one number in the field
const inv = (a) => { let r = 1, b = a % P, e = P - 2; while (e) { if (e & 1) r = (r * b) % P; b = (b * b) % P; e >>= 1; } return r; };

// Shamir: every byte becomes the constant term of a random polynomial of degree k-1, and share x is the polynomial evaluated at x.
function split(secret, n, k) {
  const shares = Array.from({ length: n }, (_, i) => ({ x: i + 1, ys: [] }));
  for (const byte of secret) {
    const coef = [byte, ...Array.from({ length: k - 1 }, () => rnd(P))];
    for (const s of shares) s.ys.push(coef.reduceRight((acc, c) => (acc * s.x + c) % P, 0));
  }
  return shares;
}
function combine(shares) { // Lagrange interpolation at x = 0
  return shares[0].ys.map((_, t) => {
    let sum = 0;
    for (const a of shares) {
      let num = 1, den = 1;
      for (const b of shares) if (b !== a) { num = (num * b.x) % P; den = (den * (b.x - a.x + P)) % P; }
      sum = (sum + a.ys[t] * num * inv(den)) % P;
    }
    return sum % 256; // values above 255 only appear for wrong shares
  });
}

const cipher = (data, key, nonce) => { // XOR with key and a stream from the nonce, so the same call encrypts and decrypts
  let s = nonce;
  return data.map((d, i) => { s = (s * 1664525 + 1013904223) % 4294967296; return d ^ key[i % key.length] ^ ((s >>> 16) & 255); });
};

class Vault {
  constructor(policies) { this.master = null; this.store = new Map(); this.audit = []; this.policies = policies; this.leases = []; this.issued = 0; }
  unseal(shares) { this.master = combine(shares); }
  put(path, text) { // envelope: a fresh data key encrypts the secret, the master key only wraps the data key
    const dek = randomBytes(KEY_BYTES), nonceW = next(), nonceC = next();
    this.store.set(path, { wrapped: cipher(dek, this.master, nonceW), nonceW, ct: cipher(toBytes(text), dek, nonceC), nonceC });
  }
  read(token, path) { // every read is logged, allowed or not
    const allowed = this.master !== null && (this.policies[token] || []).some((p) => path.startsWith(p));
    this.audit.push(`${token} ${path} ${allowed ? 'ok' : 'denied'}`);
    if (!allowed) return null;
    const e = this.store.get(path);
    return toText(cipher(e.ct, cipher(e.wrapped, this.master, e.nonceW), e.nonceC));
  }
  rotateMaster() { // rewrap each data key under a new master; the stored secrets are not touched
    const fresh = randomBytes(KEY_BYTES);
    for (const e of this.store.values()) { const dek = cipher(e.wrapped, this.master, e.nonceW); e.nonceW = next(); e.wrapped = cipher(dek, fresh, e.nonceW); }
    this.master = fresh;
  }
  issue(now, ttl, maxTtl) { const l = { user: `u-${++this.issued}`, start: now, expires: now + ttl, maxTtl }; this.leases.push(l); return l; }
  renew(l, now, ttl) { l.expires = Math.min(now + ttl, l.start + l.maxTtl); }
  sweep(now) { const dead = this.leases.filter((l) => l.expires <= now); this.leases = this.leases.filter((l) => l.expires > now); return dead.map((l) => l.user); }
}

const master0 = randomBytes(KEY_BYTES);
const shares = split(master0, SHARES, THRESHOLD);
console.log(`share 1 starts with ${shares[0].ys.slice(0, 4).join(',')}`);
let allEqual = true;
for (let i = 0; i < SHARES; i++) for (let j = i + 1; j < SHARES; j++) for (let k = j + 1; k < SHARES; k++) allEqual = allEqual && hex(combine([shares[i], shares[j], shares[k]])) === hex(master0);
const twoWork = hex(combine([shares[0], shares[1]])) === hex(master0);
console.log(`any 3 of 5 shares rebuild the master key: ${allEqual}; 2 shares do: ${twoWork}`);

const vault = new Vault({ web: ['db/web'], billing: ['db/billing'] });
vault.unseal([shares[0], shares[2], shares[4]]);
vault.put('db/web', 'p4ss-web'); vault.put('db/billing', 'p4ss-billing'); vault.put('api/stripe', 'sk_live_1');
const before = hex([...vault.store.values()].flatMap((e) => e.ct));
const reads = [['web', 'db/web'], ['web', 'db/billing'], ['billing', 'db/billing'], ['web', 'api/stripe']].map(([t, p]) => vault.read(t, p));
console.log(`reads: ${reads.map((r) => r ?? 'denied').join(' | ')}`);
vault.rotateMaster();
const keysChanged = hex(vault.master) !== hex(master0);
const afterOk = vault.read('web', 'db/web') === 'p4ss-web' && before === hex([...vault.store.values()].flatMap((e) => e.ct));
console.log(`master rotated: ${keysChanged}; 3 data keys rewrapped, stored ciphertext unchanged and readable: ${afterOk}`);
console.log(`audit has ${vault.audit.length} lines, last: ${vault.audit[vault.audit.length - 1]}`);

const a = vault.issue(0, LEASE_TTL, MAX_TTL), b = vault.issue(10, LEASE_TTL, MAX_TTL);
vault.renew(a, 50, LEASE_TTL); // a would reach 110
const gone75 = vault.sweep(75);
vault.renew(a, 100, LEASE_TTL); // capped at start + maxTtl = 120
const gone130 = vault.sweep(130);
console.log(`leases: revoked ${gone75.join(',')} at t=75, ${gone130.join(',')} at t=130 (expiry capped at ${a.expires})`);

if (!allEqual || twoWork || !afterOk || !keysChanged || vault.audit.length !== 5 || reads[1] !== null || reads[3] !== null || a.expires !== 120 || gone75.join() !== 'u-2' || gone130.join() !== 'u-1' || vault.leases.length !== 0) process.exit(1);
