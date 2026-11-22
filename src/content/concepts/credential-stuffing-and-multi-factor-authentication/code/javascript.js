// Credential stuffing in a toy model: an attacker replays 20,000 email and password pairs leaked from another site against
// this site's login, from many addresses, once per pair. 2,000 of the pairs are for real accounts here, and some users reuse
// the leaked password. Then we turn on defences one at a time and see which ones matter.
// What to look for: per-IP and per-account limits barely touch the attack (it is spread out, one try per account),
// a password breach check and multi-factor authentication do, SMS, TOTP and tap-to-approve push each fail in their own way,
// and account recovery can undo all of it.
// Seeded integer generator, fixed events, integers only: the output never changes. Every rate here is an assumption of the toy.

const USERS = 2000, ATTEMPTS = 20000, SEED = 12345;
let state = SEED;
const next = () => (state = (state * 48271) % 2147483647); // MINSTD: the same sequence in every language

// Each user's random facts, drawn up front so changing a setting never changes who is who.
function makeWorld() {
  state = SEED;
  const users = [];
  for (let u = 0; u < USERS; u++) {
    const d = Array.from({ length: 11 }, () => next() % 100);
    users.push({ reuse: d[0], enrol: d[1], fooled: d[2], simSwap: d[3], mail: d[4], known: d[5], tap: d.slice(6, 11) });
  }
  const ipRaw = Array.from({ length: ATTEMPTS }, () => next());
  return { users, ipRaw };
}
const WORLD = makeWorld();

const DEFAULTS = { reusePct: 10, ips: 5000, ipLimit: 0, acctLimit: 0, breachCover: 0, mfa: "none", enrolPct: 50, relay: false, recovery: "email" };

// Assumptions: 20% of owners are fooled by a live phishing page, 2% have a phone number that can be taken over (SIM swap),
// a tired owner approves a tap prompt 10% of the time and gets 5 prompts, 3% of owners' email accounts also fall to the leak.
function simulate(over) {
  const c = { ...DEFAULTS, ...over };
  const ipFails = new Array(c.ips).fill(0), acctFails = new Array(USERS).fill(0);
  let blockedIp = 0, blockedAcct = 0, screened = 0, hits = 0;
  const hit = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const ip = WORLD.ipRaw[i] % c.ips;
    if (c.ipLimit > 0 && ipFails[ip] >= c.ipLimit) { blockedIp++; continue; }
    const u = i % 10 === 0 ? i / 10 : -1; // one in ten pairs is for an account that exists here
    if (u < 0) { ipFails[ip]++; continue; }
    if (c.acctLimit > 0 && acctFails[u] >= c.acctLimit) { blockedAcct++; continue; }
    const w = WORLD.users[u];
    if (w.reuse < c.reusePct) {
      if (c.breachCover > 0 && w.known < c.breachCover) { screened++; continue; } // known-breached password: reset required, no login
      hits++; hit.push(u);
    } else { ipFails[ip]++; acctFails[u]++; }
  }
  const enrolled = (w) => c.mfa !== "none" && w.enrol < c.enrolPct;
  const byFatigue = (w) => w.tap.some((d) => d < 10);
  const mfaBeaten = (w) => {
    const relayed = c.relay && w.fooled < 20;
    if (c.mfa === "sms") return relayed || w.simSwap < 2;
    if (c.mfa === "totp" || c.mfa === "pushnm") return relayed;
    if (c.mfa === "push") return relayed || byFatigue(w);
    return false; // passkey: bound to the real site, so a relay or a prompt gets nothing
  };
  const taken = new Set();
  let stopped = 0;
  for (const u of hit) {
    const w = WORLD.users[u];
    if (!enrolled(w) || mfaBeaten(w)) taken.add(u); else stopped++;
  }
  const viaPassword = taken.size;
  for (let u = 0; u < USERS; u++) {
    const w = WORLD.users[u];
    if (taken.has(u) || w.mail >= 3) continue; // the attacker also holds this owner's email password
    if (c.recovery === "email" || !enrolled(w)) taken.add(u); // email-only recovery skips the second factor
  }
  return { blockedIp, blockedAcct, screened, hits, stopped, viaPassword, viaRecovery: taken.size - viaPassword, total: taken.size };
}

const show = (label, over) => {
  const r = simulate(over);
  console.log(`${label}: password hits ${r.hits} (blocked by IP limit ${r.blockedIp}, by account limit ${r.blockedAcct}, by breach check ${r.screened}), stopped by MFA ${r.stopped}, taken over ${r.viaPassword} + ${r.viaRecovery} by recovery = ${r.total}`);
};
console.log(`${USERS} accounts, ${ATTEMPTS} leaked pairs, 10% of users reuse a leaked password`);
show("no defences, 5000 IPs", {});
show("no defences, 20 IPs", { ips: 20 });
show("per-IP limit 20, 20 IPs", { ips: 20, ipLimit: 20 });
show("per-IP limit 20, 5000 IPs", { ipLimit: 20 });
show("per-account limit 5, 5000 IPs", { acctLimit: 5 });
show("breach check 70%, 5000 IPs", { breachCover: 70 });
for (const mfa of ["sms", "totp", "push", "pushnm", "passkey"]) show(`${mfa}, 50% enrolled`, { mfa });
for (const mfa of ["sms", "totp", "push", "pushnm", "passkey"]) show(`${mfa}, 50% enrolled, phishing relay`, { mfa, relay: true });
show("passkey, 100% enrolled, email recovery", { mfa: "passkey", enrolPct: 100 });
show("passkey, 100% enrolled, recovery needs the factor", { mfa: "passkey", enrolPct: 100, recovery: "email+mfa" });
show("everything: 20 IPs limit 20, breach 70, totp 100%, strict recovery", { ips: 20, ipLimit: 20, breachCover: 70, mfa: "totp", enrolPct: 100, recovery: "email+mfa" });
