// Signed tokens in JavaScript: create, verify the signature and expiry, then authorize.
// A fixed secret and clock make the demo deterministic. Real systems use a vetted library and managed keys.
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = "demo-secret-do-not-use-in-production";
const b64 = (text) => Buffer.from(text).toString("base64url");
const sign = (data) => createHmac("sha256", SECRET).update(data).digest("base64url");

function createToken(user, role, expiresAt) {
  const header = b64('{"alg":"HS256","typ":"JWT"}');
  const payload = b64(`{"sub":"${user}","role":"${role}","exp":${expiresAt}}`);
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

// Authentication: is this token genuine and still valid? Returns the claims, or throws.
function authenticate(token, now) {
  const [header, payload, signature] = token.split(".");
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const given = Buffer.from(signature ?? "");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error("401 invalid signature");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (claims.exp <= now) throw new Error("401 token expired");
  return claims;
}

// Authorization: may this known caller do this?
function authorize(claims, action, ownerOfResource) {
  if (action === "list-users" && claims.role !== "admin") throw new Error("403 admins only");
  if (action === "read-order" && claims.role !== "admin" && claims.sub !== ownerOfResource) throw new Error("403 not your order");
  return "200 ok";
}

function call(label, token, action, owner, now = 1000) {
  try {
    const claims = authenticate(token, now);
    console.log(`${label}: ${authorize(claims, action, owner)} (${claims.sub})`);
  } catch (e) {
    console.log(`${label}: ${e.message}`);
  }
}

const alice = createToken("alice", "customer", 2000);
const bob = createToken("bob", "admin", 2000);

call("alice reads her order   ", alice, "read-order", "alice");
call("alice reads bob's order ", alice, "read-order", "bob");
call("alice lists all users   ", alice, "list-users");
call("bob lists all users     ", bob, "list-users");
call("alice, after expiry     ", alice, "read-order", "alice", 2500);

// Alice edits her own token to say she is an admin, but she cannot re-sign it
const [h, , s] = alice.split(".");
const forged = `${h}.${b64('{"sub":"alice","role":"admin","exp":2000}')}.${s}`;
call("alice with a forged role", forged, "list-users");
