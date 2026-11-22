// SSRF in a toy model: an image importer that fetches a URL the user typed. There is no real network here:
// a fixed DNS table, a fixed set of redirects and 10 test URLs (3 legitimate, 7 that aim at an internal address).
// What to look for: each check blocks some attacks and is walked around by the next one (a different spelling of the same
// address, a redirect, a DNS answer that changes), and only the last variant leaves nothing reaching the inside.
// Everything is a fixed table, so the output never changes.

const DNS = {
  "images.example.com": ["203.0.113.10"],
  "cdn.example.com": ["203.0.113.11"],
  "partner.example.org": ["203.0.113.20"],
  "evil.example.net": ["203.0.113.66"],
  "rebind.example.net": ["203.0.113.50", "10.0.0.5"], // first answer public, later answers internal (a short-lived record)
  "internal-admin.corp.test": ["10.0.0.5"],
  "localhost": ["127.0.0.1"],
};
// Pages that answer with a redirect. 169.254.169.254 is the link-local address cloud platforms typically use for instance metadata.
const META = { host: "169.254.169.254", path: "/latest/meta-data/" };
const REDIRECTS = { "evil.example.net/r": META, "images.example.com/go": META };
const CASES = [
  { id: "c1", legit: true, host: "images.example.com", path: "/cat.png", note: "allowed image host" },
  { id: "c2", legit: true, host: "cdn.example.com", path: "/logo.png", note: "allowed CDN" },
  { id: "c3", legit: true, host: "partner.example.org", path: "/hook", note: "a real partner, not on the list" },
  { id: "c4", legit: false, host: "169.254.169.254", path: "/latest/meta-data/", note: "metadata address typed directly" },
  { id: "c5", legit: false, host: "localhost", path: "/admin", note: "the server's own loopback" },
  { id: "c6", legit: false, host: "2130706433", path: "/admin", note: "loopback written as one decimal number" },
  { id: "c7", legit: false, host: "internal-admin.corp.test", path: "/users", note: "a name that resolves to a private address" },
  { id: "c8", legit: false, host: "evil.example.net", path: "/r", note: "a public page that redirects to metadata" },
  { id: "c9", legit: false, host: "images.example.com", path: "/go", note: "an open redirect on an allowed host" },
  { id: "c10", legit: false, host: "rebind.example.net", path: "/x", note: "DNS says public when checked, private when fetched" },
];
const VARIANTS = ["no check", "deny-list of strings", "deny-list on resolved IP", "allow-list of hosts", "allow-list + pinned IP + no redirects"];
const DENY = ["localhost", "127.0.0.1", "169.254.169.254"];
const BASE_ALLOW = ["images.example.com", "cdn.example.com"];

function isPrivate(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

// Returns { outcome: "served" | "blocked" | "LEAK", ip, trace }. "LEAK" means the server connected to an internal address.
function fetchUrl(variant, host, path, allow) {
  const trace = [];
  const calls = {};
  const resolve = (h) => {
    let ip;
    if (/^\d+$/.test(h)) { // some URL parsers accept a whole address written as one number
      const n = Number(h);
      ip = [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join(".");
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) ip = h;
    else {
      const answers = DNS[h];
      const i = calls[h] ?? 0;
      calls[h] = i + 1;
      ip = answers[Math.min(i, answers.length - 1)];
    }
    trace.push(`resolve ${h} -> ${ip}`);
    return ip;
  };
  const stop = (why) => { trace.push(`blocked: ${why}`); return { outcome: "blocked", ip: "", trace }; };

  if (variant === 1 && DENY.includes(host)) return stop("host is on the deny-list");
  if (variant === 2 && isPrivate(resolve(host))) return stop("resolved address is private");
  if (variant >= 3 && !allow.includes(host)) return stop("host is not on the allow-list");
  let pinned = "";
  if (variant === 4) {
    pinned = resolve(host);
    if (isPrivate(pinned)) return stop("resolved address is private");
  }
  let cur = { host, path };
  for (let hops = 0; hops <= 3; hops++) {
    const ip = variant === 4 ? pinned : resolve(cur.host);
    trace.push(`connect ${ip}`);
    if (isPrivate(ip)) return { outcome: "LEAK", ip, trace };
    const next = REDIRECTS[cur.host + cur.path];
    if (!next) return { outcome: "served", ip, trace };
    if (variant === 4) return stop("redirects are not followed");
    trace.push(`redirect to ${next.host}${next.path}, followed without a new check`);
    cur = next;
  }
  return stop("too many redirects");
}

for (const partner of [false, true]) {
  const allow = partner ? [...BASE_ALLOW, "partner.example.org"] : BASE_ALLOW;
  console.log(partner ? "partner.example.org added to the allow-list" : "allow-list is images.example.com and cdn.example.com");
  VARIANTS.forEach((name, v) => {
    const r = CASES.map((c) => ({ c, ...fetchUrl(v, c.host, c.path, allow) }));
    const served = r.filter((x) => x.c.legit && x.outcome === "served").length;
    const leaks = r.filter((x) => !x.c.legit && x.outcome === "LEAK").length;
    console.log(`  ${name}: legitimate served ${served}/3, attacks reaching an internal address ${leaks}/7`);
    if (!partner) for (const x of r) console.log(`    ${x.c.id} ${x.outcome}${x.ip ? " " + x.ip : ""} (${x.c.note})`);
  });
}
console.log("trace of c9 (open redirect on an allowed host) and c10 (DNS rebinding):");
for (const id of ["c9", "c10"]) {
  const c = CASES.find((x) => x.id === id);
  for (const v of [2, 3, 4]) console.log(`  ${id} ${VARIANTS[v]}: ${fetchUrl(v, c.host, c.path, BASE_ALLOW).trace.join("; ")}`);
}
