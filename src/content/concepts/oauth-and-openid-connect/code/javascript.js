// A mini OAuth 2.0 authorization server (authorization code + PKCE S256) and the checks that matter.
// Time is passed in by hand so the demo is deterministic.
import { createHash } from 'node:crypto';

const b64url = (buf) => buf.toString('base64url');
const s256 = (verifier) => b64url(createHash('sha256').update(verifier, 'ascii').digest());

class AuthServer {
  static CODE_TTL = 60; // seconds; RFC 6749 recommends a maximum of 10 minutes, shorter is better

  constructor(registered) {
    this.registered = registered; // client_id -> the one registered redirect_uri (exact match)
    this.codes = new Map();
    this.tokens = new Map(); // access token -> still valid?
    this.n = 0;
  }

  authorize(clientId, redirectUri, challenge, method, now) {
    if (this.registered[clientId] !== redirectUri) return [false, 'invalid_request: redirect_uri is not registered']; // never redirect to it
    if (method !== 'S256' || !challenge) return [false, 'invalid_request: code_challenge with S256 is required'];
    this.n += 1;
    const code = `code-${this.n}`;
    this.codes.set(code, { client: clientId, redirect: redirectUri, challenge, exp: now + AuthServer.CODE_TTL, used: false, token: null });
    return [true, code];
  }

  token(code, clientId, redirectUri, verifier, now) {
    const rec = this.codes.get(code);
    if (!rec) return [false, 'invalid_grant: unknown code'];
    if (rec.used) {
      this.tokens.set(rec.token, false); // replay: revoke what the first redemption produced
      return [false, 'invalid_grant: code already used, its token is revoked'];
    }
    if (now > rec.exp) return [false, 'invalid_grant: code expired'];
    if (rec.client !== clientId || rec.redirect !== redirectUri) return [false, 'invalid_grant: client or redirect_uri differs from the authorization request'];
    if (!verifier || s256(verifier) !== rec.challenge) return [false, 'invalid_grant: code_verifier does not match code_challenge'];
    rec.used = true;
    rec.token = `at-${code.slice(5)}`;
    this.tokens.set(rec.token, true);
    return [true, rec.token];
  }
}

let failures = 0;
function check(label, got, wantOk) {
  console.log(`${label}: ${got[0] ? 'ok' : 'refused'} ${got[1]}`);
  if (got[0] !== wantOk) failures++;
}
const callbackStateOk = (expected, received) => expected !== null && expected === received; // the client's own check against login CSRF

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'; // RFC 7636 appendix B
const CHALLENGE = s256(VERIFIER);
const REDIRECT = 'printshop://cb';
console.log('challenge:', CHALLENGE);
if (CHALLENGE !== 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM') failures++;

const server = new AuthServer({ printshop: REDIRECT });
const [, code1] = server.authorize('printshop', REDIRECT, CHALLENGE, 'S256', 0);
check('legit redeem', server.token(code1, 'printshop', REDIRECT, VERIFIER, 5), true);
check('replay of the same code', server.token(code1, 'printshop', REDIRECT, VERIFIER, 6), false);
console.log('first token still valid:', String(server.tokens.get('at-1')));

const [, code2] = server.authorize('printshop', REDIRECT, CHALLENGE, 'S256', 10);
check('stolen code, no verifier', server.token(code2, 'printshop', REDIRECT, '', 11), false);
check('stolen code, guessed verifier', server.token(code2, 'printshop', REDIRECT, 'x'.repeat(43), 11), false);
check('redeem with other redirect_uri', server.token(code2, 'printshop', 'https://evil.test/cb', VERIFIER, 12), false);
check('legit client still succeeds', server.token(code2, 'printshop', REDIRECT, VERIFIER, 13), true);

check('authorize with forged redirect_uri', server.authorize('printshop', 'printshop://cb/../evil', CHALLENGE, 'S256', 20), false);
check('authorize without PKCE', server.authorize('printshop', REDIRECT, '', 'S256', 20), false);
const [, code3] = server.authorize('printshop', REDIRECT, CHALLENGE, 'S256', 30);
check('redeem after 61 s', server.token(code3, 'printshop', REDIRECT, VERIFIER, 91), false);

console.log('state matches:', String(callbackStateOk('k3j9', 'k3j9')));
console.log('state forged:', String(callbackStateOk('k3j9', 'attacker')));
console.log('state missing from session:', String(callbackStateOk(null, 'attacker')));
if (failures || server.tokens.get('at-1') || !callbackStateOk('k3j9', 'k3j9') || callbackStateOk('k3j9', 'attacker')) process.exit(1);
