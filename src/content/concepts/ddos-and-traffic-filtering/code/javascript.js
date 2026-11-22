// A toy tick simulation of three kinds of flood against one service, and seven ways of filtering.
// Every number is a made-up round figure chosen to show the shape of each attack, not a measurement of a real system.
// Legitimate load per tick: 60 home users with their own IP sending 2 requests each, plus one office behind a single NAT IP
// sending 80 requests: 200 in total. Attack intensity varies by 90 to 110 percent per tick from a seeded generator.
// Volumetric: packets that fill the origin's 1,000 unit link. SYN flood: spoofed SYNs that fill a 1,024 entry half-open table
// (each entry lives 5 ticks). HTTP flood: 500 real bot IPs each sending 4 valid requests per tick at an app that handles 600.
// Edge scrubbing: 8 sites of 1,000 units each; it removes 95% of a volumetric flood, proxies SYNs, drops 30% of bot requests by
// reputation, and wrongly drops 2% of legitimate traffic. A challenge is passed by 95% of legitimate users and 10% of bots.
// Assumptions: a blocklist of 10 IPs takes the 10 busiest IPs; spoofed sources are random, so IP-based filters cannot match them.

const TICKS = 10, HOMES = 60, HOME_RATE = 2, OFFICE = 80, LEGIT = HOMES * HOME_RATE + OFFICE;
const LINK_CAP = 1000, VOLUME = 5000, SYN_RATE = 3000, TABLE = 1024, SYN_HOLD = 5;
const BOTS = 500, BOT_RATE = 4, APP_CAP = 600, POPS = 8, POP_CAP = 1000, BLOCKLIST = 10;
const LIMITS = { limit3: 3, limit1: 1 };

function makeRng(seed) { let s = seed; return () => { s = (s * 48271) % 2147483647; return s; }; }

// Legitimate requests left after the defence itself has acted ("collateral damage" is LEGIT minus this).
function legitAfter(defense, stage) {
  if (defense === "block") return LEGIT - OFFICE; // the office NAT IP is the busiest IP, so it is blocked first
  if (defense in LIMITS) return HOMES * Math.min(HOME_RATE, LIMITS[defense]) + Math.min(OFFICE, LIMITS[defense]);
  if (defense === "challenge") return stage === "app" ? Math.floor((LEGIT * 95) / 100) : LEGIT;
  if (defense === "edge") return Math.floor((LEGIT * 98) / 100);
  return LEGIT;
}

function sim(attack, defense, scale) {
  const rng = makeRng(7);
  const expiring = new Array(TICKS + SYN_HOLD + 1).fill(0);
  let used = 0, served = 0, filtered = 0, through = 0;
  for (let t = 0; t < TICKS; t++) {
    const m = 90 + (rng() % 21);
    const legit = legitAfter(defense, attack === "http" ? "app" : "ip");
    filtered += LEGIT - legit;
    let l = legit, at = 0;
    if (attack === "volumetric") {
      const a = Math.floor((VOLUME * scale * m) / 100);
      if (defense === "edge") {
        at = Math.floor((a * 5) / 100);
        const cap = POPS * POP_CAP;
        if (a + LEGIT > cap) { l = Math.floor((l * cap) / (a + LEGIT)); at = Math.floor((at * cap) / (a + LEGIT)); }
      } else {
        const offered = a + LEGIT; // the link fills before any filter behind it can act
        const share = offered > LINK_CAP ? Math.floor((LEGIT * LINK_CAP) / offered) : LEGIT;
        l = Math.floor((share * legit) / LEGIT);
        at = offered > LINK_CAP ? Math.floor((a * LINK_CAP) / offered) : a;
      }
    } else if (attack === "syn") {
      const a = Math.floor((SYN_RATE * scale * m) / 100);
      if (defense !== "edge" && defense !== "cookies") {
        used -= expiring[t];
        const arrivals = a + legit;
        const admitted = Math.min(TABLE - used, arrivals);
        l = Math.floor((admitted * legit) / arrivals);
        at = admitted - l; // half-open entries held by spoofed sources
        used += admitted; expiring[t + SYN_HOLD] += admitted;
      }
    } else {
      const n = Math.floor((BOTS * scale * m) / 100);
      if (defense === "block") at = Math.max(0, n - (BLOCKLIST - 1)) * BOT_RATE; // 1 slot goes to the office, 9 to bots
      else if (defense in LIMITS) at = n * Math.min(BOT_RATE, LIMITS[defense]);
      else if (defense === "edge") at = Math.floor((n * BOT_RATE * 70) / 100);
      else if (defense === "challenge") at = Math.floor((n * BOT_RATE * 10) / 100);
      else at = n * BOT_RATE;
      const arrivals = at + legit;
      if (arrivals > APP_CAP) { l = Math.floor((APP_CAP * legit) / arrivals); at = Math.floor((APP_CAP * at) / arrivals); }
    }
    served += l; through += at;
  }
  const pct = (x) => Math.floor((x * 100) / (LEGIT * TICKS));
  return `legit served ${pct(served)}%, dropped by the filter itself ${pct(filtered)}%, attack reaching the service ${Math.floor(through / TICKS)} per tick`;
}

for (const attack of ["volumetric", "syn", "http"]) {
  for (const defense of ["none", "block", "limit3", "limit1", "edge", "cookies", "challenge"]) {
    console.log(`${attack} / ${defense}: ${sim(attack, defense, 1)}`);
  }
}
console.log(`volumetric x2 / none: ${sim("volumetric", "none", 2)}`);
console.log(`volumetric x2 / edge: ${sim("volumetric", "edge", 2)}`);
