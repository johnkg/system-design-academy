// A dependency resolver with caret ranges, a lockfile with SHA-256 integrity, a release-age gate and scoped registries.
// The "registries" are plain objects and "today" is a number, so the demo is deterministic and offline.
import { createHash } from "node:crypto";

const vt = (v) => v.split(".").map(Number);
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

function satisfies(v, rng) { // "^1.2.0" means >=1.2.0 <2.0.0 (majors here are all >= 1)
  if (rng[0] !== "^") return v === rng;
  const base = vt(rng.slice(1));
  return cmp(vt(v), base) >= 0 && vt(v)[0] === base[0];
}

const sha = (code) => createHash("sha256").update(code).digest("hex").slice(0, 8);
const rel = (ver, day, deps, code) => ({ ver, day, deps, code });

const registries = {
  public: {
    webfw: [rel("2.1.0", 1, { httputil: "^1.2.0" }, "webfw 2.1.0"), rel("2.1.4", 20, { httputil: "^1.2.0" }, "webfw 2.1.4")],
    httputil: [rel("1.2.0", 1, { textkit: "^3.0.0" }, "httputil 1.2.0"), rel("1.2.3", 10, { textkit: "^3.0.0" }, "httputil 1.2.3")],
    textkit: [rel("3.0.0", 1, {}, "textkit 3.0.0"), rel("3.0.2", 5, {}, "textkit 3.0.2")],
  },
  private: { "acme-billing": [rel("1.4.2", 3, {}, "acme-billing 1.4.2 (internal)")] },
};
const ROOT = { webfw: "^2.1.0", "acme-billing": "^1.4.0" };
const byName = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

function resolve(today, { lock = null, scopes = {}, minAge = 0 } = {}) {
  const plan = {};
  const queue = Object.entries(ROOT).sort(byName);
  while (queue.length) {
    const [name, rng] = queue.shift();
    if (plan[name]) continue;
    let reg, pick;
    if (lock && lock[name]) { // the lockfile wins: same registry, same version
      reg = lock[name].registry;
      pick = registries[reg][name].find((v) => v.ver === lock[name].version);
    } else {
      const prefix = Object.keys(scopes).find((p) => name.startsWith(p));
      const where = prefix ? [scopes[prefix]] : Object.keys(registries).sort(); // unscoped: every registry is searched
      const cands = [];
      for (const r of where) for (const v of registries[r][name] ?? []) if (satisfies(v.ver, rng) && today - v.day >= minAge) cands.push([r, v]);
      [reg, pick] = cands.reduce((a, b) => (cmp(vt(b[1].ver), vt(a[1].ver)) > 0 ? b : a)); // highest version wins, wherever it lives
    }
    plan[name] = { registry: reg, version: pick.ver, hash: sha(pick.code) };
    queue.push(...Object.entries(pick.deps).sort(byName));
  }
  return plan;
}

function install(plan, verify) { // download each artifact, then check it against the recorded hash
  for (const [name, e] of Object.entries(plan).sort(byName)) {
    const code = registries[e.registry][name].find((v) => v.ver === e.version).code;
    if (verify && sha(code) !== e.hash) throw new Error(`integrity mismatch for ${name}@${e.version}: want ${e.hash} got ${sha(code)}`);
  }
}

const show = (label, plan) => console.log(label.padEnd(22) + Object.entries(plan).sort(byName).map(([n, e]) => `${n}@${e.version}/${e.registry.slice(0, 3)}`).join(" "));
const must = (c, m) => { if (!c) { console.error("invariant violated: " + m); process.exit(1); } };

const LOCK_DAY = 30; // the day the lockfile is written
const ATTACK_DAY = 40; // the day the malicious releases appear
const TODAY = 41;
const MIN_AGE_DAYS = 3; // quarantine: ignore releases younger than this

const lock = resolve(LOCK_DAY, { scopes: { "acme-": "private" } });
show("day 30 fresh + lock", lock);
registries.public.httputil.push(rel("1.2.9", ATTACK_DAY, { textkit: "^3.0.0" }, "httputil 1.2.9 + steal(env)"));
registries.public["acme-billing"] = [rel("1.99.0", ATTACK_DAY, {}, "acme-billing 1.99.0 (attacker)")];
const floating = resolve(TODAY);
const locked = resolve(TODAY, { lock });
const gated = resolve(TODAY, { minAge: MIN_AGE_DAYS, scopes: { "acme-": "private" } });
const scoped = resolve(TODAY, { scopes: { "acme-": "private" } });
show("day 41 floating", floating);
show("day 41 lockfile", locked);
show("day 41 age gate 3d", gated);
show("day 41 scoped only", scoped);
registries.public.httputil.pop(); // yanked on day 43
registries.public.httputil[registries.public.httputil.length - 1].code = "httputil 1.2.3 + backdoor"; // same version, new bytes on a mirror
install(lock, false);
console.log("lock without check:   installed tampered bytes silently");
try {
  install(lock, true);
  must(false, "tampered artifact was accepted");
} catch (e) {
  console.log("lock with sha256:     " + e.message);
}

must(floating.httputil.version === "1.2.9" && JSON.stringify(locked) === JSON.stringify(lock), "lockfile keeps the build identical");
must(floating["acme-billing"].registry === "public" && scoped["acme-billing"].registry === "private", "scoping blocks confusion");
must(gated.httputil.version === "1.2.3", "age gate skips the fresh release");
console.log("invariants hold");
