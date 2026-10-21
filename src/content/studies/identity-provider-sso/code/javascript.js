// A tiny identity provider in JavaScript: a login session, signed tokens, key rotation,
// MFA step-up, back-channel logout and one set of keys per tenant.
// The "signature" is FNV-1a over a shared secret so the sample is deterministic; a real IdP signs with an RSA or EC private key.

const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const hex = (n) => n.toString(16).padStart(8, '0');
const TTL = 600; // token lifetime in seconds
const ACR_PASSWORD = 1, ACR_MFA = 2; // authentication strength levels
const NO_MAX_AGE = 1000000, ADMIN_MAX_AGE = 300; // seconds since the last login

class Idp {
  constructor(tenant) {
    this.tenant = tenant; this.sessions = new Map(); this.next = 1;
    this.keys = [{ kid: 'k1', secret: fnv(tenant + '/k1'), retired: null }];
  }
  active() { return this.keys[this.keys.length - 1]; }
  rotate(now) {
    this.active().retired = now; const kid = 'k' + (this.keys.length + 1);
    this.keys.push({ kid, secret: fnv(this.tenant + '/' + kid), retired: null });
  }
  // The published key set: the active key, plus a retired key until every token it signed has expired.
  jwks(now) { return new Map(this.keys.filter((k) => k.retired === null || now < k.retired + TTL).map((k) => [k.kid, k.secret])); }
  login(sub, now, mfa) {
    const sid = `${this.tenant}-s${this.next++}`;
    this.sessions.set(sid, { sub, acr: mfa ? ACR_MFA : ACR_PASSWORD, authTime: now, rps: [] });
    return sid;
  }
  stepUp(sid, now) { const s = this.sessions.get(sid); s.acr = ACR_MFA; s.authTime = now; }
  issue(sid, aud, now) {
    const s = this.sessions.get(sid); if (!s) return null;
    if (!s.rps.includes(aud)) s.rps.push(aud); // remember which apps to notify at logout
    const k = this.active();
    const body = [k.kid, s.sub, aud, sid, s.acr, s.authTime, now + TTL].join('|');
    return `${body}|${hex(fnv(k.secret + '|' + body))}`;
  }
  logout(sid, rps) { const s = this.sessions.get(sid); this.sessions.delete(sid); s.rps.forEach((a) => rps[a].revoke(sid)); return s.rps.length; }
}

class Rp { // a relying party: an application that trusts one IdP
  constructor(aud, idp) { this.aud = aud; this.idp = idp; this.revoked = new Set(); }
  revoke(sid) { this.revoked.add(sid); } // the back-channel logout endpoint
  check(token, now, minAcr = ACR_PASSWORD, maxAge = NO_MAX_AGE) {
    const f = token.split('|');
    const secret = this.idp.jwks(now).get(f[0]); // a real RP caches the key set and refetches on an unknown kid
    if (secret === undefined) return 'unknown_kid';
    if (hex(fnv(secret + '|' + f.slice(0, 7).join('|'))) !== f[7]) return 'bad_signature';
    if (f[2] !== this.aud) return 'wrong_audience';
    if (now >= Number(f[6])) return 'expired';
    if (this.revoked.has(f[3])) return 'revoked';
    if (Number(f[4]) < minAcr || now - Number(f[5]) > maxAge) return 'step_up_required';
    return 'ok';
  }
}

let fails = 0;
const expect = (label, got, want) => { console.log(`${label}: ${got}`); if (got !== want) fails++; };

const acme = new Idp('acme'), globex = new Idp('globex');
const mail = new Rp('mail', acme), wiki = new Rp('wiki', acme), rps = { mail, wiki };
const sid = acme.login('alice', 0, false);

expect('mail at 100', mail.check(acme.issue(sid, 'mail', 100), 100), 'ok');
expect('admin page at 150 (needs mfa)', wiki.check(acme.issue(sid, 'wiki', 150), 150, ACR_MFA, ADMIN_MAX_AGE), 'step_up_required');
acme.stepUp(sid, 160);
const admin = acme.issue(sid, 'wiki', 160);
expect('admin page at 170 after mfa', wiki.check(admin, 170, ACR_MFA, ADMIN_MAX_AGE), 'ok');
expect('admin page at 500 (mfa too old)', wiki.check(admin, 500, ACR_MFA, ADMIN_MAX_AGE), 'step_up_required');

const old = acme.issue(sid, 'mail', 900);
acme.rotate(1000);
expect('old token after rotation, 1100', mail.check(old, 1100), 'ok');
const fresh = acme.issue(sid, 'mail', 1100);
console.log(`signing keys: ${[...acme.jwks(1100).keys()].join(',')} at 1100, ${[...acme.jwks(1600).keys()].join(',')} at 1600`);
expect('old token at 1600', mail.check(old, 1600), 'unknown_kid');
expect('new token at 1200', mail.check(fresh, 1200), 'ok');

const forged = fresh.split('|'); forged[4] = '3';
expect('token with acr edited', mail.check(forged.join('|'), 1200), 'bad_signature');
expect('globex token at acme mail', mail.check(globex.issue(globex.login('bob', 0, true), 'mail', 1300), 1300), 'bad_signature');

const live = acme.issue(sid, 'wiki', 1250);
console.log(`logout notified ${acme.logout(sid, rps)} apps`);
expect('mail token after logout', mail.check(fresh, 1301), 'revoked');
expect('wiki token after logout', wiki.check(live, 1301), 'revoked');
expect('new token after logout', String(acme.issue(sid, 'mail', 1302)), 'null');
if (fails) process.exit(1);
