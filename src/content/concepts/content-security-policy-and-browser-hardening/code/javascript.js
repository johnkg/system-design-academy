// A toy Content Security Policy evaluator. A page requests 11 resources it needs, and an XSS flaw has let an attacker inject 4 more.
// For each policy we decide, resource by resource, what the browser would load or run. A model of the rules, not a browser:
// real CSP has more directives and edge cases. Integers and strings only, so every language prints the same lines.
const SELF = 'self';
// kind: script | style | img | frame | connect | handler (an inline event handler such as onclick). from: origin or 'inline'.
// nonce: the nonce attribute the element carries. hash: the hash of its inline text. trusted: loaded at runtime by an already trusted script.
const RESOURCES = [
  { id: 'app.js', kind: 'script', from: SELF, nonce: 'good' },
  { id: 'lib.js (cdn.example)', kind: 'script', from: 'cdn.example', nonce: 'good' },
  { id: 'track.js (analytics.vendor)', kind: 'script', from: 'analytics.vendor', nonce: 'good' },
  { id: 'inline bootstrap script', kind: 'script', from: 'inline', nonce: 'good', hash: 'h1' },
  { id: 'inline onclick handler', kind: 'handler', from: 'inline' },
  { id: 'site.css', kind: 'style', from: SELF },
  { id: 'inline style block', kind: 'style', from: 'inline', nonce: 'good', hash: 'h2' },
  { id: 'hero.png (img.cdn)', kind: 'img', from: 'img.cdn' },
  { id: 'payment iframe (pay.example)', kind: 'frame', from: 'pay.example' },
  { id: 'fetch to api.shop.example', kind: 'connect', from: 'api.shop.example' },
  { id: 'chart.js loaded by app.js', kind: 'script', from: 'unpkg.example', trusted: true },
  // Injected through an XSS flaw. "nonce" is only set when the attacker has learned the page's nonce.
  { id: 'injected inline script', kind: 'script', from: 'inline', injected: true },
  { id: 'injected img onerror handler', kind: 'handler', from: 'inline', injected: true },
  { id: 'injected script from evil.example', kind: 'script', from: 'evil.example', injected: true },
  { id: 'injected script via cdn.example', kind: 'script', from: 'cdn.example', injected: true }, // an allow-listed host that serves attacker-chosen code
];
const MAIN = 'script-src', FALLBACK = 'default-src';
const BASE = { 'img-src': ['self', 'img.cdn'], 'frame-src': ['pay.example'], 'connect-src': ['self', 'api.shop.example'] };
const POLICIES = {
  none: null,
  'allow-list + unsafe-inline': { ...BASE, 'script-src': ['self', 'cdn.example', 'analytics.vendor', 'unsafe-inline'], 'style-src': ['self', 'unsafe-inline'] },
  'allow-list only': { ...BASE, 'script-src': ['self', 'cdn.example', 'analytics.vendor'], 'style-src': ['self'] },
  'hashes + allow-list': { ...BASE, 'script-src': ['self', 'cdn.example', 'analytics.vendor', 'hash:h1'], 'style-src': ['self', 'hash:h2'] },
  'nonce + strict-dynamic': { ...BASE, 'script-src': ['nonce:good', 'strict-dynamic'], 'style-src': ['self', 'nonce:good'] },
  "default-src 'none'": { 'default-src': [] },
};

function allows(policy, r, nonceLeaked) {
  if (!policy) return true;
  const dir = { script: MAIN, handler: MAIN, style: 'style-src', img: 'img-src', frame: 'frame-src', connect: 'connect-src' }[r.kind];
  const src = policy[dir] ?? policy[FALLBACK];
  if (!src) return true;
  const nonce = r.injected ? (nonceLeaked ? 'good' : undefined) : r.nonce;
  const hasNonceOrHash = src.some((s) => s.startsWith('nonce:') || s.startsWith('hash:'));
  if (r.from === 'inline') {
    if (r.kind === 'handler') return src.includes('unsafe-inline') && !hasNonceOrHash; // nonces and hashes do not cover handler attributes
    if (nonce && src.includes('nonce:' + nonce)) return true;
    if (r.hash && !r.injected && src.includes('hash:' + r.hash)) return true;
    return src.includes('unsafe-inline') && !hasNonceOrHash; // unsafe-inline is ignored once a nonce or hash is present
  }
  if (src.includes('strict-dynamic') && r.kind === 'script') return Boolean(r.trusted || (nonce && src.includes('nonce:' + nonce))); // host lists are ignored
  if (nonce && src.includes('nonce:' + nonce)) return true;
  return src.includes(r.from === SELF ? 'self' : r.from);
}

function evaluate(policy, reportOnly, nonceLeaked) {
  const out = { legit: 0, ran: 0, violations: 0, brokenLegit: [], ranInjected: [] };
  for (const r of RESOURCES) {
    const ok = allows(policy, r, nonceLeaked);
    if (!ok) out.violations++;
    const loads = ok || reportOnly; // report-only logs the violation but changes nothing
    if (r.injected) { if (loads && r.kind !== 'img') { out.ran++; out.ranInjected.push(r.id); } }
    else if (loads) out.legit++; else out.brokenLegit.push(r.id);
  }
  return out;
}

const line = (name, o) => `${name}: legit resources loaded ${o.legit} of 11; injected scripts that run ${o.ran} of 4; violations reported ${o.violations}`;
console.log('-- enforcing, nonce not leaked');
for (const [name, p] of Object.entries(POLICIES)) console.log('  ' + line(name, evaluate(p, false, false)));
console.log('-- what an injected script still runs under each policy');
for (const [name, p] of Object.entries(POLICIES)) { const o = evaluate(p, false, false); console.log(`  ${name}: ${o.ranInjected.join(', ') || 'none'}`); }
console.log('-- what breaks for legitimate resources');
for (const name of ['allow-list only', 'hashes + allow-list', 'nonce + strict-dynamic']) console.log(`  ${name}: ${evaluate(POLICIES[name], false, false).brokenLegit.join(', ') || 'nothing'}`);
console.log('-- break it: the same nonce on every response, so the attacker copies it');
console.log('  ' + line('nonce + strict-dynamic, static nonce', evaluate(POLICIES['nonce + strict-dynamic'], false, true)));
console.log('-- report-only rollout: nothing blocked, violations collected first');
console.log('  ' + line('allow-list only, report-only', evaluate(POLICIES['allow-list only'], true, false)));
console.log('  ' + line("default-src 'none', report-only", evaluate(POLICIES["default-src 'none'"], true, false)));

// Other headers: each one stops one kind of attack, none replaces a CSP.
const ATTACKS = [
  ['first visit over http, attacker strips the redirect to https', 'hsts', 'HSTS (after a first visit)'],
  ['evil.example frames the page to trick clicks', 'frame-ancestors', 'frame-ancestors'],
  ["an uploaded .txt is sniffed and run as script", 'nosniff', 'X-Content-Type-Options: nosniff'],
  ['evil.example posts a form to the shop with the session cookie', 'samesite', 'SameSite=Lax cookie'],
];
function headers(set) {
  const stopped = ATTACKS.filter(([, key]) => set.includes(key));
  return `headers [${set.join(', ') || 'none'}]: stops ${stopped.length} of 4 attacks`;
}
console.log('-- other headers');
console.log('  ' + headers([]));
console.log('  ' + headers(['frame-ancestors']));
console.log('  ' + headers(['hsts', 'frame-ancestors', 'nosniff', 'samesite']));
for (const [what, key, name] of ATTACKS) console.log(`  with only frame-ancestors and SameSite: ${what}: ${['frame-ancestors', 'samesite'].includes(key) ? 'stopped by ' + name : 'still works'}`);
