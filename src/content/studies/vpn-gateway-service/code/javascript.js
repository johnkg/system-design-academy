// A small VPN gateway fleet, in JavaScript: pick a gateway by latency plus load, keep a session alive across address changes,
// detect a dead peer, drain a gateway without dropping its users, and split traffic by route.
const fnv = (...xs) => { let h = 0x811c9dc5; for (const x of xs) h = Math.imul((h ^ x) >>> 0, 16777619) >>> 0; return h; };
let seed = 7;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };

const LAT = [[10, 60, 120], [60, 10, 90], [120, 90, 10], [30, 40, 100]]; // ms from each region to each gateway
const CAP = 8;
const gateways = LAT.map((lat, id) => ({ id, lat, draining: false, sessions: new Map() }));

// Cost = round-trip time plus a penalty that grows with load; full or draining gateways are not candidates.
function pick(region, useLoad) {
  let best = null, bestCost = 1e9;
  for (const g of gateways) {
    if (g.draining || g.sessions.size >= CAP) continue;
    const cost = g.lat[region] + (useLoad ? Math.floor(g.sessions.size * 60 / CAP) : 0);
    if (cost < bestCost) { best = g; bestCost = cost; }
  }
  return best;
}

function connect(sid, region) {
  const g = pick(region, true);
  const s = { sid, key: fnv(sid, 99), region, addr: 1000 + sid, lastSeq: 0, lastSeen: 0, gw: g.id };
  g.sessions.set(sid, s);
  return s;
}

// A packet carries session id, sequence number and a tag. The source address is NOT part of the identity, so a client can roam.
const tagOf = (key, sid, seq) => fnv(key, sid, seq);
function receive(g, pkt, now) {
  const s = g.sessions.get(pkt.sid);
  if (!s) return 'unknown session';
  if (pkt.tag !== tagOf(s.key, pkt.sid, pkt.seq)) return 'bad tag';
  if (pkt.seq <= s.lastSeq) return 'replay';
  const roamed = pkt.addr !== s.addr;
  s.addr = pkt.addr; s.lastSeq = pkt.seq; s.lastSeen = now;
  return roamed ? 'ok, roamed' : 'ok';
}
const packet = (s, seq, addr) => ({ sid: s.sid, seq, addr, tag: tagOf(s.key, s.sid, seq) });

// Dead-peer detection: a keepalive every 10 ticks, and a peer is dead after 3 missed keepalives.
const deadPeers = (g, now) => [...g.sessions.values()].filter((s) => now - s.lastSeen >= 30).map((s) => s.sid);

// Drain: stop accepting, then resume every session elsewhere with the same key and sequence number.
function drain(g) {
  g.draining = true;
  let moved = 0;
  for (const s of [...g.sessions.values()]) {
    const to = pick(s.region, true);
    g.sessions.delete(s.sid); s.gw = to.id; to.sessions.set(s.sid, s); moved++;
  }
  return moved;
}

const ip = (a, b, c, d) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
const inNet = (addr, net, bits) => (addr >>> (32 - bits)) === (net >>> (32 - bits));
const viaTunnel = (addr) => inNet(addr, ip(10, 0, 0, 0), 8) || inNet(addr, ip(192, 168, 0, 0), 16);

const clients = Array.from({ length: 24 }, (_, i) => ({ sid: i + 1, region: rnd(3) }));
const nearest = [0, 0, 0, 0];
for (const c of clients) nearest[LAT.map((l) => l[c.region]).indexOf(Math.min(...LAT.map((l) => l[c.region])))]++;
const sessions = clients.map((c) => connect(c.sid, c.region));
const loads = () => gateways.map((g) => g.sessions.size).join(',');
const avg = () => Math.floor(sessions.reduce((t, s) => t + gateways[s.gw].lat[s.region], 0) / sessions.length);
console.log('nearest only:', nearest.join(','), '| latency and load:', loads(), '| avg ms:', avg());
console.assert(gateways.every((g) => g.sessions.size <= CAP));

const s1 = sessions[0], g1 = gateways[s1.gw];
console.log('seq 1 from home:', receive(g1, packet(s1, 1, s1.addr), 5));
console.log('seq 2 from new network:', receive(g1, packet(s1, 2, 7000), 10));
console.log('seq 2 again:', receive(g1, packet(s1, 2, 8000), 11));
console.log('forged tag:', receive(g1, { ...packet(s1, 3, 9000), tag: 1 }, 12));
console.log('silent since tick 10, dead at 39:', deadPeers(g1, 39).includes(s1.sid), '| at 40:', deadPeers(g1, 40).includes(s1.sid));

const busiest = gateways.reduce((a, b) => (b.sessions.size > a.sessions.size ? b : a));
const before = busiest.sessions.size;
console.log('drain gateway', busiest.id, 'moved', drain(busiest), 'of', before, '| loads:', loads());
console.assert(busiest.sessions.size === 0 && gateways.reduce((t, g) => t + g.sessions.size, 0) === 24);
const sample = sessions.find((s) => s.sid === s1.sid);
console.log('session kept its sequence:', receive(gateways[sample.gw], packet(sample, 3, 7100), 20));
console.log('split tunnel:', [ip(10, 4, 1, 9), ip(192, 168, 7, 1), ip(142, 250, 1, 1)].map((a) => (viaTunnel(a) ? 'tunnel' : 'direct')).join(','));
