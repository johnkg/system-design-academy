// Hash vs MAC vs signature, in a toy model. WARNING: the "hash" below is a 32-bit FNV-1a, a STAND-IN so that every language
// prints the same numbers. It is NOT secure, and neither are the 4-byte tags or the textbook RSA with tiny primes.
// The point is the structure: what each construction lets an attacker do, not the strength of the numbers.
const bytes = (s) => Array.from(s, (c) => c.charCodeAt(0));
// The output of this hash is its internal state, with no final step. That is the property length extension needs.
const step = (h, bs) => { for (const b of bs) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const H = (bs) => step(2166136261, bs);
const hex = (h) => h.toString(16).padStart(8, '0');
const yn = (b) => (b ? 'yes' : 'no');

// HMAC: the real construction (an inner and an outer hash, with the key mixed in twice), over the toy hash. Block size 16.
function hmac(key, msg) {
  const k = bytes(key); while (k.length < 16) k.push(0);
  const inner = H([...k.map((b) => b ^ 0x36), ...bytes(msg)]);
  return H([...k.map((b) => b ^ 0x5c), inner >>> 24, (inner >>> 16) & 255, (inner >>> 8) & 255, inner & 255]);
}
const naiveMac = (secret, msg) => H(bytes(secret + msg)); // hash(secret + message): NOT an HMAC

// Textbook RSA with tiny primes (61 * 53): the public key is (3233, 17), the private exponent is 2753.
const N = 3233, E = 17, D = 2753;
const modpow = (b, e, m) => { let r = 1; b %= m; while (e > 0) { if (e & 1) r = (r * b) % m; b = (b * b) % m; e >>= 1; } return r; };
const sign = (msg) => modpow(H(bytes(msg)) % N, D, N);                    // needs the private exponent
const verifySig = (msg, sig) => modpow(sig, E, N) === H(bytes(msg)) % N;  // needs only the public key

const SECRET = 'k3y-s3cret', BODY = 'id=evt77&order=1001&amount=500', EDITED = 'id=evt77&order=1001&amount=9999';

const okHash = (body, h) => H(bytes(body)) === h;
const okHmac = (body, t) => hmac(SECRET, body) === t;
console.log('-- 1. a plain hash: integrity against accidents, nothing about who');
console.log(`hash(body) = ${hex(H(bytes(BODY)))}`);
console.log(`attacker edits the amount and sends the hash of the edited body: server accepts = ${yn(okHash(EDITED, H(bytes(EDITED))))}`);

console.log('-- 2. HMAC: only a holder of the key can make a tag');
const tag = hmac(SECRET, BODY);
console.log(`hmac(key, body) = ${hex(tag)}`);
console.log(`edited body with the old tag: server accepts = ${yn(okHmac(EDITED, tag))}`);
console.log(`edited body with a tag made from a guessed key: server accepts = ${yn(okHmac(EDITED, hmac('guess', EDITED)))}`);

console.log('-- 3. length extension: hash(secret + message) is not an HMAC');
const EXTRA = '&amount=9999';
const nTag = naiveMac(SECRET, BODY);
const forgedTag = step(nTag, bytes(EXTRA)); // the attacker never sees the secret: they just keep hashing from the tag
console.log(`naive tag of the original = ${hex(nTag)}; forged tag for body + "${EXTRA}" = ${hex(forgedTag)}`);
console.log(`server recomputes hash(secret + longer body): accepts = ${yn(naiveMac(SECRET, BODY + EXTRA) === forgedTag)}`);
console.log(`same trick on the HMAC tag: accepts = ${yn(hmac(SECRET, BODY + EXTRA) === step(tag, bytes(EXTRA)))}`);

console.log('-- 4. non-repudiation: who could have made this message?');
const mine = 'id=evt78&order=1002&amount=1';
console.log(`receiver makes its own message with the shared HMAC key: verifies = ${yn(okHmac(mine, hmac(SECRET, mine)))} (so the tag cannot prove the sender made it)`);
const sig = sign(BODY);
console.log(`signature of the body = ${sig}; verifies with the public key = ${yn(verifySig(BODY, sig))}`);
console.log(`receiver signs its own message without the private exponent (best guess 1234): verifies = ${yn(verifySig(mine, 1234))}`);
console.log(`edited body with the old signature: verifies = ${yn(verifySig(EDITED, sig))}`);

console.log('-- 5. comparing tags: early exit leaks, constant time does not (comparisons stand in for time)');
const early = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) { n++; if (a[i] !== b[i]) return { ok: false, n }; } return { ok: true, n }; };
const constant = (a, b) => { let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return { ok: diff === 0, n: a.length }; };
const target = [tag >>> 24, (tag >>> 16) & 255, (tag >>> 8) & 255, tag & 255];
function recover(compare) {
  const known = []; let guesses = 0;
  for (let i = 0; i < 4; i++) {
    let best = -1, bestScore = -1, same = true, first = -1;
    for (let v = 0; v < 256; v++) {
      const g = [...known, v, 0, 0, 0].slice(0, 4); guesses++;
      const r = compare(g, target); const score = r.ok ? 99 : r.n;
      if (first < 0) first = score;
      if (score !== first) same = false;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    if (same) return { done: false, guesses };
    known.push(best);
  }
  return { done: true, guesses, tag: known.reduce((a, b) => a * 256 + b, 0) };
}
for (const [name, cmp] of [['early exit', early], ['constant time', constant]]) {
  const r = recover(cmp);
  console.log(`${name}: ${r.done ? `tag ${hex(r.tag)} recovered in ${r.guesses} guesses (brute force: 4294967296 possible tags)` : `no signal after ${r.guesses} guesses: every guess costs the same`}`);
}

console.log('-- 6. replay: a captured, correctly signed webhook sent again');
// cfg: window = seconds a timestamp may be old (0 = not checked), remember = keep the ids already seen, covers = the signature covers the timestamp.
function replayRun(label, cfg) {
  const signedText = (ts, body) => (cfg.covers ? `${ts}.${body}` : body);
  const seen = new Set(); let credited = 0;
  const receive = (now, ts, body, s) => {
    if (hmac(SECRET, signedText(ts, body)) !== s) return 'rejected: bad signature';
    if (cfg.window > 0 && now - ts > cfg.window) return 'rejected: too old';
    if (cfg.remember) { if (seen.has('evt77')) return 'rejected: already processed'; seen.add('evt77'); }
    credited++; return 'accepted';
  };
  const s0 = hmac(SECRET, signedText(1000, BODY));
  const out = [`first delivery ${receive(1000, 1000, BODY, s0)}`];
  out.push(`replay after 10 s ${receive(1010, 1000, BODY, s0)}`);
  out.push(`replay after 600 s ${receive(1600, 1000, BODY, s0)}`);
  out.push(`replay after 600 s with a fresh timestamp ${receive(1600, 1600, BODY, s0)}`);
  console.log(`${label}: ${out.join('; ')}. Times credited: ${credited}.`);
}
replayRun('no checks', { window: 0, remember: false, covers: true });
replayRun('300 s window only', { window: 300, remember: false, covers: true });
replayRun('300 s window and seen ids', { window: 300, remember: true, covers: true });
replayRun('window only, timestamp not signed', { window: 300, remember: false, covers: false });
