// Simplified BGP best-path selection on a tiny AS graph, with anycast, longest-prefix match and RPKI filtering.
const ASN = { T1: 100, W: 200, E: 300, siteW: 64500, siteE: 64500, siteT: 64500, c1: 11, c2: 12, c3: 13, c4: 14, evil: 666 };
// [provider, customer] links and [peer, peer] links; the relation is what the neighbour is to me.
const CUSTOMER_LINKS = [["T1", "W"], ["T1", "E"], ["T1", "siteT"], ["T1", "c4"], ["W", "siteW"], ["E", "siteE"],
  ["W", "c1"], ["E", "c2"], ["W", "c3"], ["E", "c3"], ["W", "evil"]];
const PEER_LINKS = [["W", "E"]];
const NODES = Object.keys(ASN);
const nbrs = Object.fromEntries(NODES.map((n) => [n, []]));
for (const [p, c] of CUSTOMER_LINKS) { nbrs[p].push([c, "customer"]); nbrs[c].push([p, "provider"]); }
for (const [a, b] of PEER_LINKS) { nbrs[a].push([b, "peer"]); nbrs[b].push([a, "peer"]); }
const LOCAL_PREF = { customer: 200, peer: 100, provider: 50 };

const ipToInt = (s) => s.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const covers = (prefix, ip) => {
  const [net, len] = prefix.split("/"); const d = 2 ** (32 - Number(len));
  return Math.floor(ipToInt(net) / d) === Math.floor(ipToInt(ip) / d);
};
const roaOk = (asn, len) => asn === 64500 && len <= 23; // ROA: 192.0.2.0/23, origin 64500, maxLength 23

// Higher local-pref, then shorter AS path, then lowest neighbour AS (stand-in for router ID).
const better = (a, b) => a.pref !== b.pref ? a.pref > b.pref
  : a.path.length !== b.path.length ? a.path.length < b.path.length : ASN[a.via] < ASN[b.via];

// Propagate one prefix to a fixed point. Export rule: customer routes go to everyone, peer/provider routes only to customers.
function propagate(origins, len, rovNodes) {
  const best = {};
  for (const o of origins) best[o] = { origin: o, path: [], pref: 1000, via: null, own: true };
  for (let changed = true; changed;) {
    changed = false;
    for (const node of NODES) {
      if (origins.includes(node)) continue;
      let pick = null;
      for (const [n, rel] of nbrs[node]) {
        const r = best[n]; if (!r) continue;
        const learnedFromCustomer = r.own || nbrs[n].find(([x]) => x === r.via)[1] === "customer";
        if (!learnedFromCustomer && rel !== "provider") continue; // n only exports non-customer routes to its customers
        const path = [ASN[n], ...r.path];
        if (path.includes(ASN[node])) continue; // loop prevention
        if (rovNodes.includes(node) && !roaOk(ASN[r.origin], len)) continue; // RPKI: drop invalid origin / too specific
        const cand = { origin: r.origin, path, pref: LOCAL_PREF[rel], via: n, own: false };
        if (!pick || better(cand, pick)) pick = cand;
      }
      const old = best[node];
      if (pick?.via !== old?.via || pick?.path.join() !== old?.path.join()) {
        if (pick) best[node] = pick; else delete best[node];
        changed = true;
      }
    }
  }
  return best;
}

// Longest-prefix match: a client uses the most specific prefix it holds a route for.
function reach(client, dst, announcements, rovNodes) {
  const ordered = [...announcements].sort((a, b) => Number(b.prefix.split("/")[1]) - Number(a.prefix.split("/")[1]));
  for (const a of ordered) {
    if (!covers(a.prefix, dst)) continue;
    const r = propagate(a.origins, Number(a.prefix.split("/")[1]), rovNodes)[client];
    if (r) return r.origin;
  }
  return "none";
}

const check = (ok, msg) => { if (!ok) { console.log("FAILED: " + msg); process.exit(1); } };
const DST = "192.0.2.10", CLIENTS = ["c1", "c2", "c3", "c4"];
const anycast = (sites) => [{ prefix: "192.0.2.0/23", origins: sites }];
const show = (title, ann, rov = []) => {
  const out = Object.fromEntries(CLIENTS.map((c) => [c, reach(c, DST, ann, rov)]));
  console.log(`${title}: ` + CLIENTS.map((c) => `${c}=${out[c]}`).join(" "));
  return out;
};

const all = show("3-site anycast", anycast(["siteW", "siteE", "siteT"]));
check(all.c1 === "siteW" && all.c2 === "siteE", "customer routes pick the local site");
check(all.c3 === "siteW", "tie on pref and length: lowest neighbour AS wins");
check(all.c4 === "siteT", "shortest AS path wins");
const down = show("withdraw siteW", anycast(["siteE", "siteT"]));
check(down.c1 === "siteE" && down.c3 === "siteE", "withdrawal re-routes to the next best site");
const hijack = [...anycast(["siteW", "siteE", "siteT"]), { prefix: "192.0.2.0/24", origins: ["evil"] }];
const open = show("hijack /24, no ROV", hijack);
check(CLIENTS.every((c) => open[c] === "evil"), "a more specific /24 beats the /23 everywhere");
const partial = show("ROV at tier-1 only", hijack, ["T1"]);
check(partial.c1 === "evil" && partial.c4 === "siteT", "filtering only far upstream does not stop the neighbours");
const filtered = show("ROV at evil ISP", hijack, ["W"]);
check(CLIENTS.every((c) => filtered[c] === all[c]), "filtering at the source ISP contains the hijack");
console.log("invariants hold");
