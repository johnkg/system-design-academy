// A toy VPC routing evaluator: "can A reach B?" by longest-prefix route lookup, plus the checks that make a route usable.
// Topology: VPC A 10.0.0.0/16 with a public subnet (web, public IP), a private subnet (app) and a database subnet (db).
// A NAT gateway sits in the public subnet. A peer VPC B, an on-premises network 192.168.0.0/16 (over a VPN) and the internet are outside.
// Assumptions: security groups and ACLs allow everything, so only routing is judged; the VPN's far side routes replies back;
// peering needs non-overlapping CIDRs and a route on BOTH sides; an internet gateway only serves hosts with a public IP.

const ipv = (s) => s.split(".").reduce((acc, o) => acc * 256 + Number(o), 0);
const parse = (cidr) => { const [b, n] = cidr.split("/"); const bits = Number(n); return { base: ipv(b), bits, size: 2 ** (32 - bits) }; };
const contains = (cidr, ip) => { const c = parse(cidr); const a = ipv(ip); return a >= c.base && a < c.base + c.size; };
const overlaps = (x, y) => { const a = parse(x), b = parse(y); return a.base < b.base + b.size && b.base < a.base + a.size; };
const isPrivate = (ip) => contains("10.0.0.0/8", ip) || contains("172.16.0.0/12", ip) || contains("192.168.0.0/16", ip);

// Longest prefix wins; on a tie the earlier entry (the local route) wins.
function lookup(table, ip) {
  let best = null;
  for (const [cidr, target] of table) if (contains(cidr, ip) && (best === null || parse(cidr).bits > best.bits)) best = { bits: parse(cidr).bits, target };
  return best === null ? null : best.target;
}

const VPC = "10.0.0.0/16";
const HOSTS = { web: "10.0.1.10", app: "10.0.2.10", db: "10.0.3.10" };

function buildTables(c) {
  const extra = [];
  if (c.vpn) extra.push(["192.168.0.0/16", "vpn"]);
  if (c.peerRoute) extra.push([c.peerCidr, "peering"]);
  const pub = [[VPC, "local"], ["0.0.0.0/0", "igw"], ...extra];
  const priv = [[VPC, "local"], ...(c.nat ? [["0.0.0.0/0", "nat"]] : []), ...extra];
  const db = [[VPC, "local"], ...(c.dbOpen ? [["0.0.0.0/0", "igw"]] : [])];
  return { web: pub, app: priv, db };
}

function reach(c, tables, src, dest) {
  const target = lookup(tables[src], dest);
  const hasPublicIp = src === "web" || (src === "db" && c.dbOpen);
  if (target === null) return "no route";
  if (target === "local") return Object.values(HOSTS).includes(dest) ? "ok (local)" : "no such host here";
  if (target === "igw") return !hasPublicIp ? "no public IP" : isPrivate(dest) ? "private address dropped" : "ok (internet gateway)";
  if (target === "nat") return isPrivate(dest) ? "private address dropped" : "ok (NAT gateway)";
  if (target === "peering") return overlaps(VPC, c.peerCidr) ? "peering impossible (overlap)" : !c.peerBack ? "reply has no route back" : "ok (peering)";
  return "ok (VPN)";
}

function evaluate(name, c) {
  const tables = buildTables(c);
  const octets = c.peerCidr.split("/")[0].split(".");
  const peerHost = `${octets[0]}.${octets[1]}.${octets[2]}.10`; // a host at .10 in the peer VPC's first subnet
  const dests = [["internet", "8.8.8.8"], ["peer", peerHost], ["onprem", "192.168.5.5"], ["db", HOSTS.db]];
  let ok = 0;
  console.log(`${name}:`);
  for (const src of ["web", "app", "db"]) {
    const cells = dests.map(([label, ip]) => {
      const r = src === "db" && label === "db" ? "-" : reach(c, tables, src, ip);
      if (r.startsWith("ok")) ok++;
      return `${label}=${r}`;
    });
    console.log(`  ${src} -> ${cells.join(", ")}`);
  }
  const inWeb = lookup(tables.web, "203.0.113.9") === "igw" ? "reachable" : "no path";
  const inDb = c.dbOpen && lookup(tables.db, "203.0.113.9") === "igw" ? "reachable" : "no path";
  console.log(`  internet -> web: ${inWeb}, internet -> db: ${inDb}; working paths: ${ok}`);
}

const BASE = { nat: true, vpn: false, peerRoute: false, peerBack: false, peerCidr: "10.1.0.0/16", dbOpen: false };
evaluate("baseline", BASE);
evaluate("no NAT route in the private subnet", { ...BASE, nat: false });
evaluate("peering, route on one side only", { ...BASE, peerRoute: true });
evaluate("peering, routes on both sides", { ...BASE, peerRoute: true, peerBack: true });
evaluate("peering, overlapping CIDRs", { ...BASE, peerRoute: true, peerBack: true, peerCidr: "10.0.0.0/16" });
evaluate("VPN route added", { ...BASE, vpn: true });
evaluate("database subnet with a default route and public IP", { ...BASE, dbOpen: true });
