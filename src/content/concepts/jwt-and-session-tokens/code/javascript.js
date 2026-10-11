// Minimal JWT (HS256) sign and verify using only the standard library.
// Verification pins the algorithm, checks the signature in constant time, then checks exp, iss and aud.
import crypto from "node:crypto";

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url");
const mac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest();

function sign(claims, secret, header = '{"alg":"HS256","typ":"JWT"}') {
  const payload = `{"iss":"${claims.iss}","sub":"${claims.sub}","aud":"${claims.aud}","exp":${claims.exp}}`;
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${b64(mac(secret, input))}`;
}

function verify(token, secret, expect) {
  const parts = token.split(".");
  if (parts.length !== 3) return "reject: malformed";
  let header, claims;
  try { header = JSON.parse(unb64(parts[0]).toString()); } catch { return "reject: malformed"; }
  if (header.alg !== "HS256") return "reject: alg is not HS256"; // pin it, never trust the header (blocks none)
  const want = mac(secret, `${parts[0]}.${parts[1]}`);
  const got = unb64(parts[2]);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return "reject: bad signature";
  try { claims = JSON.parse(unb64(parts[1]).toString()); } catch { return "reject: malformed"; }
  if (claims.exp <= expect.now) return "reject: expired";
  if (claims.iss !== expect.iss) return "reject: wrong issuer";
  if (claims.aud !== expect.aud) return "reject: wrong audience";
  return "ok";
}

const SECRET = "demo-secret-at-least-32-bytes-long!";
const NOW = 1000;
const expect = { now: NOW, iss: "auth.shop", aud: "orders-api" };
const good = { iss: "auth.shop", sub: "alice", aud: "orders-api", exp: NOW + 300 };

const token = sign(good, SECRET);
console.log("token: " + token.slice(0, 36) + "...");

const [h, p, s] = token.split(".");
const tamperedPayload = b64('{"iss":"auth.shop","sub":"admin","aud":"orders-api","exp":1300}');
const cases = [
  ["valid token", token, "ok"],
  ["alg=none, empty signature", `${b64('{"alg":"none","typ":"JWT"}')}.${p}.`, "reject: alg is not HS256"],
  ["tampered payload (sub=admin)", `${h}.${tamperedPayload}.${s}`, "reject: bad signature"],
  ["signed with another key", sign(good, "some-other-secret-of-32-bytes-xxxx"), "reject: bad signature"],
  ["expired", sign({ ...good, exp: NOW - 1 }, SECRET), "reject: expired"],
  ["wrong audience", sign({ ...good, aud: "billing-api" }, SECRET), "reject: wrong audience"],
  ["wrong issuer", sign({ ...good, iss: "evil.example" }, SECRET), "reject: wrong issuer"],
  ["two parts only", `${h}.${p}`, "reject: malformed"],
];

let failed = 0;
for (const [name, tok, want] of cases) {
  const got = verify(tok, SECRET, expect);
  const okay = got === want;
  if (!okay) failed++;
  console.log(`${name.padEnd(30)} -> ${got}${okay ? "" : " (EXPECTED " + want + ")"}`);
}
if (failed) { console.log(`${failed} case(s) wrong`); process.exit(1); }
console.log("all " + cases.length + " cases behave as expected");
