// CIDR math with plain integers: parse, describe, split, overlap check and longest-prefix match.

const check = (ok) => { if (!ok) { console.error("invariant violated"); process.exit(1); } };
const maskOf = (p) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
const parseIp = (s) => s.split(".").reduce((acc, o) => acc * 256 + Number(o), 0);
const fmtIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");

function parseCidr(text) {
  const [ip, len] = text.split("/");
  const prefix = Number(len);
  const net = (parseIp(ip) & maskOf(prefix)) >>> 0; // clear the host bits
  const size = 2 ** (32 - prefix);
  return { net, prefix, size, last: net + size - 1 };
}
const show = (c) => `${fmtIp(c.net)}/${c.prefix}`;

// Cloud VPCs reserve 5 addresses per subnet: network, router, DNS, future use, broadcast.
function describe(text) {
  const c = parseCidr(text);
  return `${show(c)} addresses=${c.size} usable=${c.size - 5} first=${fmtIp(c.net + 4)} last=${fmtIp(c.last - 1)} mask=${fmtIp(maskOf(c.prefix))}`;
}

// Borrow bits: n subnets need ceil(log2 n) extra prefix bits, giving 2^bits equal slots.
function split(block, count) {
  let bits = 0;
  while (2 ** bits < count) bits++;
  const prefix = block.prefix + bits;
  const step = 2 ** (32 - prefix);
  return Array.from({ length: 2 ** bits }, (_, i) => ({ net: block.net + i * step, prefix, size: step, last: block.net + (i + 1) * step - 1 }));
}

const overlaps = (a, b) => a.net <= b.last && b.net <= a.last;

// Longest-prefix match: every route whose prefix contains the address matches; the most specific wins.
function lookup(routes, ipText) {
  const ip = parseIp(ipText);
  let best = null;
  for (const r of routes) {
    const c = parseCidr(r.cidr);
    if (((ip & maskOf(c.prefix)) >>> 0) === c.net && (best === null || c.prefix > best.prefix)) best = { prefix: c.prefix, target: r.target };
  }
  return best === null ? "no route (dropped)" : `${best.target} via /${best.prefix}`;
}

for (const t of ["10.0.0.0/16", "10.0.3.0/24", "192.168.1.0/28", "172.16.0.0/12"]) console.log(describe(t));
check(parseCidr("10.0.0.0/16").size === 65536);
check(parseCidr("10.0.0.77/24").net === parseIp("10.0.0.0"));

// Three tiers x three zones = 9 subnets -> 4 bits -> 16 slots of /20, tier by tier.
const slots = split(parseCidr("10.20.0.0/16"), 9);
const tiers = ["public", "private", "database"];
slots.slice(0, 9).forEach((s, i) => console.log(`${tiers[Math.floor(i / 3)]}-${"abc"[i % 3]} ${show(s)} usable=${s.size - 5}`));
console.log(`slots=${slots.length} free=${slots.length - 9}`);
const quarters = split(parseCidr("192.168.10.0/24"), 4);
console.log(quarters.map(show).join(" "));
check(slots.length === 16 && slots[0].size === 4096);
check(quarters.length === 4 && quarters.every((q) => q.size === 64));

for (const [a, b] of [["10.20.0.0/16", "10.0.0.0/16"], ["10.0.0.0/16", "10.0.5.0/24"], ["172.20.0.0/16", "172.16.0.0/12"], ["10.0.0.0/16", "10.1.0.0/16"]]) {
  console.log(`overlap ${a} ${b} ${overlaps(parseCidr(a), parseCidr(b))}`);
}
check(overlaps(parseCidr("172.20.0.0/16"), parseCidr("172.16.0.0/12")));
check(!overlaps(parseCidr("10.20.0.0/16"), parseCidr("10.0.0.0/16")));

// Order in the table does not matter: the default route is listed first on purpose.
const table = [
  { cidr: "0.0.0.0/0", target: "nat" },
  { cidr: "10.20.0.0/16", target: "local" },
  { cidr: "10.0.0.0/16", target: "vpn" },
  { cidr: "10.20.48.99/32", target: "quarantine" },
];
const cases = [["10.20.48.10", "local via /16"], ["10.0.0.5", "vpn via /16"], ["8.8.8.8", "nat via /0"], ["10.20.48.99", "quarantine via /32"]];
for (const [ip, want] of cases) {
  const got = lookup(table, ip);
  console.log(`${ip} -> ${got}`);
  if (got !== want) { console.error(`expected ${want}`); process.exit(1); }
}
console.log(`database table, 8.8.8.8 -> ${lookup([{ cidr: "10.20.0.0/16", target: "local" }], "8.8.8.8")}`);
