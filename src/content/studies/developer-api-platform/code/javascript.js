// A developer API platform core: hashed API keys with scopes, plan quotas, version pinning and a breaking-change check.
const fnv = (s) => { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }; // stands in for SHA-256

const PLANS = { free: 5, pro: 8 }; // calls per month
const WARN_PCT = 80; // warn when this share of the quota is used
const EXTRA_CALLS = 5; // enough calls to exhaust the free quota
const NEED = { 'GET /payments': 'payments:read', 'POST /payments': 'payments:write', 'GET /refunds': 'refunds:read' };
const store = new Map(); // hash of the key -> record. The key itself is never stored.

function issueKey(name, plan, scopes, version) {
  const secret = 'sk_' + fnv(name + ':a').toString(16).padStart(8, '0') + fnv(name + ':b').toString(16).padStart(8, '0');
  store.set(fnv(secret), { name, plan, scopes, version, used: 0 });
  return secret; // shown to the developer once
}

function handle(secret, route) {
  const rec = store.get(fnv(secret));
  if (!rec) return '401 unknown key';
  const need = NEED[route];
  if (!rec.scopes.includes(need)) return `403 needs ${need}`;
  const limit = PLANS[rec.plan];
  if (rec.used >= limit) return '429 monthly quota used';
  rec.used++;
  const warn = rec.used * 100 >= limit * WARN_PCT ? ' (80% of quota used)' : '';
  return `200 ok, version ${rec.version}${warn}`;
}

// A spec is a flat map: "METHOD /path req|res name" -> type (requests also say optional or required).
function diff(oldSpec, newSpec) {
  const out = [];
  const keys = [...new Set([...Object.keys(oldSpec), ...Object.keys(newSpec)])].sort();
  for (const key of keys) {
    const o = oldSpec[key], n = newSpec[key], kind = key.split(' ')[2];
    let verb, breaking;
    if (o === undefined) { verb = 'added'; breaking = kind === 'req' && n.endsWith('|required'); }
    else if (n === undefined) { verb = 'removed'; breaking = true; }
    else if (o !== n) {
      verb = `changed ${o} -> ${n}`;
      breaking = o.split('|')[0] !== n.split('|')[0] || (o.endsWith('|optional') && n.endsWith('|required'));
    } else continue;
    out.push({ key, verb, breaking });
  }
  return out;
}

const v1 = {
  'GET /payments req limit': 'int|optional', 'GET /payments res id': 'string', 'GET /payments res amount': 'int', 'GET /payments res status': 'string',
  'POST /payments req amount': 'int|required', 'POST /payments req currency': 'string|required', 'POST /payments res id': 'string', 'GET /refunds res id': 'string',
};
const v2 = {
  'GET /payments req limit': 'int|optional', 'GET /payments req cursor': 'string|optional', 'GET /payments res id': 'string', 'GET /payments res amount': 'string',
  'GET /payments res created': 'string', 'POST /payments req amount': 'int|required', 'POST /payments req currency': 'string|required',
  'POST /payments req idempotency_key': 'string|required', 'POST /payments req note': 'string|optional', 'POST /payments res id': 'string',
};

const web = issueKey('acme-web', 'free', ['payments:read'], '2025-03-01');
const admin = issueKey('acme-admin', 'pro', ['payments:read', 'payments:write'], '2026-01-15');
console.log(`web key ${web.slice(0, 7)}..., admin key ${admin.slice(0, 7)}...`);
const calls = [[web, 'GET /payments'], [web, 'POST /payments'], [web, 'GET /refunds'], ['sk_bad', 'GET /payments'], [admin, 'POST /payments']];
for (let i = 0; i < EXTRA_CALLS; i++) calls.push([web, 'GET /payments']);
for (const [key, route] of calls) console.log(`${key === web ? 'web  ' : key === admin ? 'admin' : 'other'} ${route.padEnd(14)} -> ${handle(key, route)}`);

const changes = diff(v1, v2);
for (const c of changes) console.log(`${c.breaking ? 'BREAKING' : 'safe    '} ${c.key}: ${c.verb}`);
const breaking = changes.filter((c) => c.breaking).length;
console.log(`${breaking} breaking, ${changes.length - breaking} safe: release ${breaking > 0 ? 'blocked, ship it as a new version' : 'allowed'}`);

const plaintext = [...store.values()].some((r) => JSON.stringify(r).includes(web) || JSON.stringify(r).includes(admin));
if (plaintext || breaking !== 4 || changes.length !== 7 || handle(web, 'GET /payments') !== '429 monthly quota used') process.exit(1);
