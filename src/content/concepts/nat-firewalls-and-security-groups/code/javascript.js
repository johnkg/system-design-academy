// A toy packet filter and a toy source-NAT table.
// Part 1: a stateless ACL (ordered rules, first match wins, replies need their own rule)
//         against a stateful security group (allow rules only, replies ride the connection table).
// Part 2: source NAT: how a reply finds its way back, and what happens when the port pool runs out.
// Assumptions: IPv4, TCP only. The guarded server listens on 443, 22 and 5432. "Outside" means outside 10.0.0.0/8.
// Real NAT devices typically have about 64,000 ports per public address; the pool here is tiny so the effect is visible.

const ipv = (s) => s.split(".").reduce((acc, o) => acc * 256 + Number(o), 0);
function inCidr(addr, cidr) {
  const [base, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  const b = ipv(base);
  return addr >= b && addr < b + size;
}
// rule = [action, cidr, firstPort, lastPort]; the cidr matches the peer address, the ports match the local port
function evaluate(rules, peer, port) {
  for (const [action, cidr, lo, hi] of rules) {
    if (inCidr(ipv(peer), cidr) && port >= lo && port <= hi) return action === "allow";
  }
  return false; // default deny
}

const LISTENING = [443, 22, 5432];
const EPHEMERAL = 50000; // the client's source port; a reply goes back to it
const ATTEMPTS = [
  ["203.0.113.5", 443], ["198.51.100.7", 443], ["203.0.113.5", 22],
  ["10.0.1.9", 5432], ["203.0.113.9", 5432], ["192.0.2.44", 80],
];
const ANY = "0.0.0.0/0";
const RETURN = ["allow", ANY, 1024, 65535];
const CONFIGS = [
  ["stateless ACL, inbound rules only", false, [["allow", ANY, 443, 443], ["allow", "10.0.0.0/16", 5432, 5432]], []],
  ["stateless ACL, with return rule", false, [["allow", ANY, 443, 443], ["allow", "10.0.0.0/16", 5432, 5432]], [RETURN]],
  ["stateful group, same allow rules", true, [["allow", ANY, 443, 443], ["allow", "10.0.0.0/16", 5432, 5432]], []],
  ["ACL, deny /24 listed first", false, [["deny", "203.0.113.0/24", 0, 65535], ["allow", ANY, 443, 443], ["allow", "10.0.0.0/16", 5432, 5432]], [RETURN]],
  ["ACL, deny /24 listed second", false, [["allow", ANY, 443, 443], ["deny", "203.0.113.0/24", 0, 65535], ["allow", "10.0.0.0/16", 5432, 5432]], [RETURN]],
  ["stateful group, allow all to test", true, [["allow", ANY, 0, 65535]], []],
];

for (const [name, stateful, inRules, outRules] of CONFIGS) {
  let works = 0, reached = 0;
  const exposed = [];
  for (const [client, port] of ATTEMPTS) {
    const request = evaluate(inRules, client, port);
    const reply = stateful ? request : evaluate(outRules, client, EPHEMERAL);
    if (request) reached++;
    if (request && reply && LISTENING.includes(port)) {
      works++;
      if (!client.startsWith("10.") && port !== 443) exposed.push(port);
    }
  }
  console.log(`${name}: requests that reach the server=${reached} connections that work=${works} internet-reachable admin ports=${exposed.length === 0 ? "none" : exposed.join(",")}`);
}

// Part 2: source NAT. Each outbound connection gets a public port; the reply is matched against that table.
const PUBLIC_IP = "198.51.100.1";
const entries = []; // [publicPort, "privateIp:port"]
for (const [priv, port] of [["10.0.2.10", 40001], ["10.0.2.11", 40001], ["10.0.2.10", 40002]]) {
  const pub = 1024 + entries.length;
  entries.push([pub, `${priv}:${port}`]);
  console.log(`SNAT ${priv}:${port} -> ${PUBLIC_IP}:${pub}`);
}
for (const p of [1025, 9999]) {
  const row = entries.find((e) => e[0] === p);
  console.log(row ? `reply to ${PUBLIC_IP}:${p} -> ${row[1]}` : `unsolicited packet to ${PUBLIC_IP}:${p} -> dropped (no table entry)`);
}

// Tick model of the port pool: `rate` new connections per tick, each holding its port for `hold` ticks.
function natRun(pool, rate, hold, ticks) {
  const expiring = new Array(ticks + hold + 1).fill(0);
  let used = 0, allocated = 0, dropped = 0, peak = 0;
  for (let t = 0; t < ticks; t++) {
    used -= expiring[t];
    const got = Math.min(rate, pool - used);
    used += got; allocated += got; dropped += rate - got;
    expiring[t + hold] += got;
    peak = Math.max(peak, used);
  }
  return `pool=${pool} rate=${rate}/tick hold=${hold} ticks: allocated=${allocated} dropped=${dropped} peak in use=${peak}`;
}
console.log(natRun(20, 4, 3, 30));
console.log(natRun(20, 4, 6, 30));
console.log(natRun(40, 4, 6, 30));
