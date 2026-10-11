// An edge shield core, in JavaScript:
// a WAF that adds up rule points (anomaly scoring), and a detector that learns normal traffic and switches on a challenge for unfamiliar clients.

const RULES = [['union select', 4], ['<script', 4], ['../', 5], ["' or ", 4], ['--', 1], ['select ', 1]]; // a needle and its points
const BLOCK_AT = 5;

// One weak signal is logged, several weak signals together are blocked.
function score(req) {
  const text = req.path.toLowerCase();
  let total = 0;
  for (const [needle, points] of RULES) if (text.includes(needle)) total += points;
  if (req.ua === '') total += 2; // real browsers always send a user agent
  return total;
}

// Learns the normal request rate. While it sees an attack it stops learning, or the attack would become "normal".
class Baseline {
  constructor() { this.mean = 100; this.dev = 10; this.hot = 0; }
  observe(rate) {
    if (rate > this.mean + 4 * this.dev) this.hot++;
    else { this.hot = 0; this.dev = 0.8 * this.dev + 0.2 * Math.abs(rate - this.mean); this.mean = 0.8 * this.mean + 0.2 * rate; }
    return this.hot >= 2; // two seconds in a row above the limit
  }
}

let seed = 2024;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const samples = [
  { path: '/search?q=blue shoes', ua: 'Mozilla' },
  { path: '/search?q=select a size -- how', ua: 'Mozilla' },
  { path: "/item?id=1' or 1=1 --", ua: 'Mozilla' },
  { path: '/comment?body=<script>alert(1)</script>', ua: 'Mozilla' },
  { path: '/comment?body=<script>alert(1)</script>', ua: '' },
  { path: '/../../etc/passwd', ua: 'Mozilla' },
];
const scores = samples.map(score);
console.log(`waf scores: ${scores.join(' ')}; blocked: ${scores.map((s) => (s >= BLOCK_AT ? 'yes' : 'no')).join(' ')}`);

const IP_LIMIT = 20; // requests per IP per second
const baseline = new Baseline();
let detectedAt = -1, challengeFrom = -1;
const stat = { realIn: 0, realBlocked: 0, botIn: 0, botIpLimited: 0, botChallenged: 0, botPassed: 0, botBefore: 0 };
for (let t = 0; t < 60; t++) {
  const real = 100 + random(21) - 10;
  const bots = t >= 20 ? 900 + random(41) - 20 : 0; // from second 20, 300 IPs send about 3 requests per second each
  if (detectedAt < 0 && baseline.observe(real + bots)) { detectedAt = t; challengeFrom = t + 2; } // the rule takes 2 more seconds to reach the edge
  const challenge = challengeFrom >= 0 && t >= challengeFrom;
  for (let i = 0; i < real; i++) {
    stat.realIn++;
    const fp = random(100) < 2 ? 100 + random(5) : random(12); // fingerprints 0 to 11 are common browsers, 100 and up are rare ones
    if (challenge && fp >= 100 && random(100) >= 90) stat.realBlocked++; // a few real people fail the challenge
  }
  const perIp = new Array(300).fill(0);
  for (let i = 0; i < bots; i++) {
    stat.botIn++;
    const ip = random(300); random(3); // the bots use 3 fingerprints, all unknown
    if (++perIp[ip] > IP_LIMIT) { stat.botIpLimited++; continue; }
    if (challenge && random(100) >= 5) { stat.botChallenged++; continue; }
    stat.botPassed++;
    if (!challenge) stat.botBefore++;
  }
}
console.log(`attack detected at second ${detectedAt}, challenge from second ${challengeFrom}`);
console.log(`bot requests: ${stat.botIn}; stopped by the per-IP limit: ${stat.botIpLimited}; stopped by the challenge: ${stat.botChallenged}; passed: ${stat.botPassed} (${stat.botBefore} before the challenge)`);
console.log(`real requests: ${stat.realIn}; blocked by mistake: ${stat.realBlocked}`);

const ok = scores.join('') === '025465' && detectedAt === 21 && stat.botPassed < stat.botIn * 0.15 && stat.realBlocked < stat.realIn * 0.01 && stat.botIpLimited === 0;
if (!ok) process.exit(1);
