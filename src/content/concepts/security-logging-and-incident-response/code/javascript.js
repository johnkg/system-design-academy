// Security logging in a toy model: redaction, a hash-chained log, and detection rules over one seeded day of login events.
// Seeded generator (Park-Miller), integers only. WARNING: the hash used for the chain is a 32-bit FNV-1a STAND-IN, not secure;
// a real log chain uses a cryptographic hash or an HMAC, and keeps its head hash somewhere the attacker cannot write.
const hex = (h) => h.toString(16).padStart(8, '0');
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };

console.log('-- 1. what never goes in a log: secrets are redacted before the line is written');
const SENSITIVE = ['password', 'token', 'card'];
function redact(line) {
  return line.split(' ').map((kv) => {
    if (!kv.includes('=')) return kv;
    const [k, v] = [kv.split('=')[0], kv.split('=')[1]];
    if (!SENSITIVE.includes(k)) return kv;
    return k === 'card' ? `${k}=****${v.slice(-4)}` : `${k}=[redacted]`;
  }).join(' ');
}
const raw = 'login_failed user=alice ip=203.0.113.7 password=hunter2 token=abc123 card=4111111111111111 reason=bad_password';
console.log(`  raw:      ${raw}`);
console.log(`  redacted: ${redact(raw)}`);

console.log('-- 2. tamper evidence: each entry commits to the one before it');
const LINES = ['login ok user=alice', 'role_change user=bob role=admin by=alice', 'export_report user=bob rows=50000', 'login ok user=carol', 'delete_user user=dave by=bob'];
const chain = (lines) => { let prev = 0; return lines.map((l) => (prev = fnv(hex(prev) + '|' + l))); };
const verify = (lines, stored, anchor) => {
  const now = chain(lines);
  for (let i = 0; i < stored.length; i++) if (now[i] !== stored[i]) return `broken at entry ${i + 1}`;
  if (lines.length !== stored.length) return 'chain consistent, but length differs from the stored hashes';
  if (anchor === null) return 'chain consistent, nothing outside to compare the head with';
  return now[now.length - 1] === anchor ? 'intact, head matches the anchor' : 'chain consistent, but the head does not match the anchor: tampering detected';
};
const stored = chain(LINES); const anchor = stored[stored.length - 1];
console.log(`  head hash ${hex(anchor)}, copy kept in a separate write-once store`);
const edited = [...LINES]; edited[1] = 'role_change user=bob role=viewer by=alice';
console.log(`  untouched: ${verify(LINES, stored, anchor)}`);
console.log(`  entry 2 edited: ${verify(edited, stored, anchor)}`);
console.log(`  entry 2 edited and every later hash recomputed, anchor kept elsewhere: ${verify(edited, chain(edited), anchor)}`);
console.log(`  entry 2 edited and every later hash recomputed, no anchor: ${verify(edited, chain(edited), null)}`);
console.log(`  last 2 entries deleted, hashes truncated to match: ${verify(LINES.slice(0, 3), chain(LINES.slice(0, 3)), anchor)}`);

console.log('-- 3. detection: failed logins over one day (1,440 minutes), 23 sources');
let seed = 12345;
const rnd = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
const DAY = 1440, NORMAL = 20;
// Sources 0..19 ordinary users (1 person each), 20 the office NAT (40 people), 21 attacker A (fast), 22 attacker B (slow and spread out).
const OFFICE = 20, A = 21, B = 22, SRC = 23;
const USERS = Array.from({ length: SRC }, (_, i) => (i === OFFICE ? 40 : 1));
const fails = Array.from({ length: SRC }, () => new Array(DAY).fill(0));
const wins = Array.from({ length: SRC }, () => new Array(DAY).fill(0));
for (let m = 0; m < DAY; m++) {
  for (let s = 0; s < SRC; s++) {
    if (s < NORMAL) {
      if (rnd(1000) < 6) { fails[s][m] += 1 + (rnd(100) < 25 ? 1 + rnd(3) : 0); if (m + 1 < DAY) wins[s][m + 1] = 1; } // a mistyped password, then a correct one
    } else if (s === OFFICE) {
      if (rnd(100) < 5) fails[s][m] += 1;
      if (m >= 540 && m < 550) fails[s][m] += 3;  // a password rotation notice lands at 09:00: 40 people retype
      wins[s][m] = 1;                             // somebody in the office logs in every minute
    } else if (s === A && m >= 800 && m < 810) fails[s][m] = 8;
    else if (s === B && m >= 200 && m < 500) fails[s][m] = 1;
  }
}
wins[A][810] = 1; wins[B][500] = 1; // the attackers get in
const ATTACK = { [A]: { start: 800, breach: 810 }, [B]: { start: 200, breach: 500 } };
const TRIAGE = 10, COOLDOWN = 60;
const sum = (arr, from, to) => { let t = 0; for (let i = Math.max(0, from); i <= to; i++) t += arr[i]; return t; };

function detect(window, threshold, correlate, response) {
  const alerts = []; const last = new Array(SRC).fill(-1000);
  for (let m = 0; m < DAY; m++) for (let s = 0; s < SRC; s++) {
    if (m - last[s] < COOLDOWN) continue;
    let why = '';
    if (sum(fails[s], m - window + 1, m) >= threshold) why = 'rate';
    else if (correlate && wins[s][m] && sum(fails[s], m - 15, m - 1) >= 3) why = 'success after failures';
    if (why) { alerts.push({ t: m, s, why }); last[s] = m; }
  }
  // One on-call engineer, first come first served, 10 minutes per alert.
  let free = 0, maxWait = 0, blocked = 0; const seenBlocked = new Set();
  const first = { [A]: null, [B]: null };
  for (const a of alerts) {
    const start = Math.max(a.t, free); free = start + TRIAGE; maxWait = Math.max(maxWait, start - a.t);
    a.done = free;
    const real = a.s === A || a.s === B;
    if (!real && response === 'auto' && !seenBlocked.has(a.s)) { seenBlocked.add(a.s); blocked += USERS[a.s]; }
    if (real && first[a.s] === null) first[a.s] = a;
  }
  const falseAlerts = alerts.filter((a) => a.s !== A && a.s !== B).length;
  const result = { alerts: alerts.length, falseAlerts, maxWait, blocked, who: {} };
  for (const s of [A, B]) {
    const a = first[s];
    if (!a) { result.who[s] = 'never detected'; continue; }
    const contained = response === 'auto' ? a.t + 1 : a.done + (response === 'runbook' ? 2 : 15);
    const ttd = a.t - ATTACK[s].start, ttc = contained - ATTACK[s].start;
    result.who[s] = `detected ${ttd} min after it began, contained ${ttc} min after; ${contained < ATTACK[s].breach ? 'stopped before the login succeeded' : `attacker had access for ${contained - ATTACK[s].breach} min`}`;
  }
  return result;
}
function show(label, w, t, correlate, response) {
  const r = detect(w, t, correlate, response);
  console.log(`  ${label}: alerts ${r.alerts}, of which false ${r.falseAlerts}; longest wait for a look ${r.maxWait} min; legit users locked out ${r.blocked}`);
  console.log(`    fast attacker: ${r.who[A]}`);
  console.log(`    slow attacker: ${r.who[B]}`);
}
show('5 min window, 3 failures, manual', 5, 3, false, 'manual');
show('5 min window, 10 failures, manual', 5, 10, false, 'manual');
show('5 min window, 20 failures, manual', 5, 20, false, 'manual');
show('60 min window, 40 failures, manual', 60, 40, false, 'manual');
show('60 min window, 40 failures, runbook', 60, 40, false, 'runbook');
show('5 min window, 10 failures, auto-block', 5, 10, false, 'auto');
show('5 min window, 20 failures plus success-after-failures rule, manual', 5, 20, true, 'manual');
