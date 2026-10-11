// The core of a login service, in JavaScript (node, standard library only):
// a slow salted password hash, a one-time code (TOTP, RFC 6238), and refresh tokens that rotate and detect theft.
import crypto from 'node:crypto';
const hex = (buf) => buf.toString('hex');
const sha256 = (s) => hex(crypto.createHash('sha256').update(s).digest());

// 1. Slow salted hash. Every user has their own salt, and the iteration count is the price an attacker pays per guess.
const ITERATIONS = 20000;
const hashPassword = (password, salt) => hex(crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256'));
const verifyPassword = (password, salt, stored) => crypto.timingSafeEqual(Buffer.from(hashPassword(password, salt), 'hex'), Buffer.from(stored, 'hex'));

// 2. TOTP: HMAC of the number of 30-second steps since 1970, cut down to a few digits (dynamic truncation).
function totp(secret, seconds, digits) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));
  const mac = crypto.createHmac('sha1', secret).update(counter).digest();
  const offset = mac[19] & 15;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
// Accept the previous, current and next step, because phone clocks drift.
const verifyTotp = (secret, seconds, given) => [-30, 0, 30].some((d) => totp(secret, seconds + d, 6) === given);

// 3. Refresh tokens rotate: each one is used once and replaced. Using an old one means a copy was stolen, so the whole family dies.
class TokenService {
  constructor(key) { this.key = key; this.counter = 0; this.byHash = new Map(); this.families = new Map(); }
  mint(family) { // the server stores only the hash of a token, like a password
    const token = sha256(`${this.key}:${++this.counter}`).slice(0, 12);
    this.byHash.set(sha256(token), { family, used: false });
    return token;
  }
  login(user) { this.families.set(user, 'alive'); return this.mint(user); }
  refresh(token) {
    const rec = this.byHash.get(sha256(token));
    if (!rec) return { ok: false, why: 'unknown' };
    if (this.families.get(rec.family) !== 'alive') return { ok: false, why: 'family revoked' };
    if (rec.used) { this.families.set(rec.family, 'revoked'); return { ok: false, why: 'reuse detected, family revoked' }; }
    rec.used = true;
    return { ok: true, token: this.mint(rec.family) };
  }
}

const salt = 'a1b2c3d4e5f60718';
const stored = hashPassword('correct horse battery', salt);
console.log(`hash: ${stored.slice(0, 16)}`);
console.log(`right password: ${verifyPassword('correct horse battery', salt, stored)}, wrong password: ${verifyPassword('correct horse batterz', salt, stored)}`);
console.log(`same password, another salt gives another hash: ${hashPassword('correct horse battery', 'ffffffffffffffff') !== stored}`);

const secret = Buffer.from('12345678901234567890');
console.log(`totp rfc vectors: ${totp(secret, 59, 8)} ${totp(secret, 1111111109, 8)} ${totp(secret, 1234567890, 8)}`);
const now = 1700000010, code = totp(secret, now, 6);
console.log(`code ${code}: now ${verifyTotp(secret, now, code)}, 30s late ${verifyTotp(secret, now + 30, code)}, 90s late ${verifyTotp(secret, now + 90, code)}`);

const svc = new TokenService('server-key');
const r1 = svc.login('ann');
const r2 = svc.refresh(r1).token, r3 = svc.refresh(r2).token;
const replay = svc.refresh(r1);
const after = svc.refresh(r3);
console.log(`replay of r1: ${replay.why}; newest token afterwards: ${after.why}`);
const other = svc.refresh(svc.login('bob'));
console.log(`another user is unaffected: ${other.ok}`);

if (totp(secret, 59, 8) !== '94287082' || totp(secret, 1111111109, 8) !== '07081804' || totp(secret, 1234567890, 8) !== '89005924') process.exit(1);
if (replay.ok || after.ok || !other.ok || verifyPassword('correct horse batterz', salt, stored)) process.exit(1);
