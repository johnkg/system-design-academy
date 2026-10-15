// Envelope encryption with a key management service, in JavaScript.
// WARNING: the cipher below (FNV-1a hashing and an LCG keystream XOR) is a TOY to show the structure. It is NOT real cryptography.
// Shape: root key (the "HSM") wraps key versions, a key version wraps data keys, a data key encrypts the data.
let seed = 7;
const rng = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const bytes = (s) => [...s].map((c) => c.charCodeAt(0));
const text = (b) => String.fromCharCode(...b);
const hex = (n) => n.toString(16).padStart(8, '0');
const fnv = (key, data) => { let h = (2166136261 ^ key) >>> 0; for (const b of data) h = Math.imul(h ^ b, 16777619) >>> 0; return h; };
const xor = (key, nonce, data) => { let s = (key ^ nonce) >>> 0; return data.map((b) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return b ^ (s >>> 24); }); };
const word = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const unword = (b) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;

class Kms {
  constructor(rootKey) { this.rootMask = fnv(rootKey, [1]); this.keys = new Map(); this.day = 0; this.audit = []; this.chain = 0; }
  log(who, action, keyId, outcome) {                       // append-only log; each entry is chained to the one before
    const line = `${this.audit.length + 1} day${this.day} ${who} ${action} ${keyId} ${outcome}`;
    this.audit.push(line); this.chain = fnv(this.chain, bytes(line));
  }
  verify() { let c = 0; for (const l of this.audit) c = fnv(c, bytes(l)); return c === this.chain; }
  run(who, action, keyId, fn) {                            // policy check, the operation, and an audit entry for every outcome
    const k = this.keys.get(keyId);
    if (!k || !(k.policy[action] || []).includes(who)) { this.log(who, action, keyId, 'DENIED'); throw new Error('denied'); }
    try { const r = fn(k); this.log(who, action, keyId, 'OK'); return r; }
    catch (e) { this.log(who, action, keyId, 'FAILED ' + e.message); throw e; }
  }
  addVersion(k) { k.wrapped.push(rng() ^ this.rootMask); } // key material is stored only wrapped by the root key
  kek(k, v) { if (!k.wrapped[v - 1]) throw new Error('unknown version'); return (k.wrapped[v - 1] ^ this.rootMask) >>> 0; }
  usable(k) { if (k.state !== 'enabled') throw new Error(k.state === 'pending' ? 'pending deletion' : 'destroyed'); }
  create(who, keyId, policy) { this.keys.set(keyId, { policy, wrapped: [], state: 'enabled', deleteAt: 0 }); this.addVersion(this.keys.get(keyId)); this.log(who, 'create', keyId, 'OK'); }
  rotate(who, keyId) { this.run(who, 'admin', keyId, (k) => this.addVersion(k)); }
  seal(k, dk) { const v = k.wrapped.length, nonce = rng(), ct = xor(this.kek(k, v), nonce, word(dk)); return { v, nonce, ct, mac: fnv(this.kek(k, v) ^ nonce, ct) }; }
  generateDataKey(who, keyId) { return this.run(who, 'encrypt', keyId, (k) => { this.usable(k); const dk = rng(); return { dk, blob: this.seal(k, dk) }; }); }
  open(k, b) { const kek = this.kek(k, b.v); if (fnv(kek ^ b.nonce, b.ct) !== b.mac) throw new Error('bad mac'); return unword(xor(kek, b.nonce, b.ct)); }
  decrypt(who, keyId, blob) { return this.run(who, 'decrypt', keyId, (k) => { this.usable(k); return this.open(k, blob); }); }
  rewrap(who, keyId, blob) { return this.run(who, 'rewrap', keyId, (k) => { this.usable(k); return this.seal(k, this.open(k, blob)); }); } // the data key never leaves the service
  scheduleDeletion(who, keyId, days) { this.run(who, 'admin', keyId, (k) => { k.state = 'pending'; k.deleteAt = this.day + days; }); }
  cancelDeletion(who, keyId) { this.run(who, 'admin', keyId, (k) => { k.state = 'enabled'; }); }
  advance(days) { this.day += days; for (const [id, k] of this.keys) if (k.state === 'pending' && this.day >= k.deleteAt) { k.state = 'destroyed'; k.wrapped = []; this.log('system', 'destroy', id, 'OK'); } }
}

const put = (kms, who, keyId, plain) => { const { dk, blob } = kms.generateDataKey(who, keyId), nonce = rng(); return { blob, nonce, ct: xor(dk, nonce, bytes(plain)) }; };
const get = (kms, who, keyId, rec) => text(xor(kms.decrypt(who, keyId, rec.blob), rec.nonce, rec.ct));
const attempt = (fn) => { try { return 'ok ' + fn(); } catch (e) { return 'error ' + e.message; } };
const versions = (docs) => docs.map((d) => d.blob.v).join(',');

const kms = new Kms(0x5eed1234);
kms.create('secops', 'orders', { encrypt: ['app', 'batch'], decrypt: ['app'], rewrap: ['batch'], admin: ['secops'] });
const docs = ['card:4111-0001', 'card:4111-0002', 'card:4111-0003'].map((t) => put(kms, 'app', 'orders', t));
console.log(`3 objects encrypted, blob versions: ${versions(docs)}, first ciphertext ${docs[0].ct.map((b) => b.toString(16).padStart(2, '0')).join('')}`);
kms.rotate('secops', 'orders');
docs.push(put(kms, 'app', 'orders', 'card:4111-0004'));
console.log(`after rotation, blob versions: ${versions(docs)}, old object still reads: ${get(kms, 'app', 'orders', docs[0])}`);
const before = docs.map((d) => d.ct.join());
const moved = docs.map((d) => ({ ...d, blob: kms.rewrap('batch', 'orders', d.blob) }));
console.log(`rewrapped, blob versions: ${versions(moved)}, data ciphertext untouched: ${moved.every((d, i) => d.ct.join() === before[i])}`);
console.log(`batch decrypt: ${attempt(() => get(kms, 'batch', 'orders', moved[0]))}; mallory encrypt: ${attempt(() => kms.generateDataKey('mallory', 'orders'))}`);
kms.scheduleDeletion('secops', 'orders', 7);
console.log(`during the wait: ${attempt(() => get(kms, 'app', 'orders', moved[1]))}`);
kms.cancelDeletion('secops', 'orders');
console.log(`after cancel: ${attempt(() => get(kms, 'app', 'orders', moved[1]))}`);
kms.advance(3); kms.scheduleDeletion('secops', 'orders', 7); kms.advance(6);
console.log(`day ${kms.day}, still waiting: ${attempt(() => get(kms, 'app', 'orders', moved[2]))}`);
kms.advance(1);
console.log(`day ${kms.day}, deleted: ${attempt(() => get(kms, 'app', 'orders', moved[2]))}`);
const count = (w) => kms.audit.filter((l) => l.includes(w)).length;
console.log(`audit: ${kms.audit.length} entries, ${count(' OK')} ok, ${count('DENIED')} denied, ${count('FAILED')} failed, chain ${hex(kms.chain)}, intact ${kms.verify()}`);
const forged = kms.audit.slice(); kms.audit[3] = kms.audit[3].replace('OK', 'DENIED');
console.log(`after editing one entry, chain intact: ${kms.verify()}`);
kms.audit = forged;
if (versions(docs) !== '1,1,1,2' || count('DENIED') !== 2 || !kms.verify()) process.exit(1);
