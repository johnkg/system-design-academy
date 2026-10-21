// An edge shield core, in JavaScript:
// a WAF that adds up rule points (anomaly scoring), and a detector that learns normal traffic and switches on a challenge for unfamiliar clients.

const RULES = [['union select', 4], ['<script', 4], ['../', 5], ["' or ", 4], ['--', 1], ['select ', 1]]; // a needle and its points
const BLOCK_AT = 5;
const NO_UA_POINTS = 2;
// Baseline: starting guess, alert above mean + 4 deviations, exponential smoothing weights, seconds in a row to alert.
const INITIAL_MEAN = 100, INITIAL_DEV = 10, ALERT_DEVS = 4, KEEP = 0.8, LEARN = 0.2, HOT_SECONDS = 2;

// One weak signal is logged, several weak signals together are blocked.
function score(req) {
  const text = req.path.toLowerCase();
  let total = 0;
  for (const [needle, points] of RULES) if (text.includes(needle)) total += points;
  if (req.ua === '') total += NO_UA_POINTS; // real browsers always send a user agent
  return total;
}

// Learns the normal request rate. While it sees an attack it stops learning, or the attack would become "normal".
class Baseline {
  constructor() { this.mean = INITIAL_MEAN; this.dev = INITIAL_DEV; this.hot = 0; }
  observe(rate) {
    if (rate > this.mean + ALERT_DEVS * this.dev) this.hot++;
    else { this.hot = 0; this.dev = KEEP * this.dev + LEARN * Math.abs(rate - this.mean); this.mean = KEEP * this.mean + LEARN * rate; }
    return this.hot >= HOT_SECONDS; // two seconds in a row above the limit
  }
}

const SEED = 2024;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
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
const SECONDS = 60, REAL_RATE = 100, REAL_JITTER = 10;
const ATTACK_START = 20, BOT_RATE = 900, BOT_JITTER = 20, BOT_IPS = 300, BOT_FINGERPRINTS = 3;
const RULE_DELAY = 2; // seconds for the challenge rule to reach the edge
const RARE_PERCENT = 2, RARE_FP = 100, RARE_KINDS = 5, COMMON_FPS = 12; // browser fingerprints
const REAL_FAIL_PERCENT = 10, BOT_PASS_PERCENT = 5; // who fails or passes the challenge
const MAX_BOT_PASSED = 0.15, MAX_REAL_BLOCKED = 0.01; // acceptance limits, as fractions
const baseline = new Baseline();
let detectedAt = -1, challengeFrom = -1;
const stat = { realIn: 0, realBlocked: 0, botIn: 0, botIpLimited: 0, botChallenged: 0, botPassed: 0, botBefore: 0 };
for (let t = 0; t < SECONDS; t++) {
  const real = REAL_RATE + random(2 * REAL_JITTER + 1) - REAL_JITTER;
  const bots = t >= ATTACK_START ? BOT_RATE + random(2 * BOT_JITTER + 1) - BOT_JITTER : 0; // from second 20, 300 IPs send about 3 requests per second each
  if (detectedAt < 0 && baseline.observe(real + bots)) { detectedAt = t; challengeFrom = t + RULE_DELAY; } // the rule takes 2 more seconds to reach the edge
  const challenge = challengeFrom >= 0 && t >= challengeFrom;
  for (let i = 0; i < real; i++) {
    stat.realIn++;
    const fp = random(100) < RARE_PERCENT ? RARE_FP + random(RARE_KINDS) : random(COMMON_FPS); // fingerprints 0 to 11 are common browsers, 100 and up are rare ones
    if (challenge && fp >= RARE_FP && random(100) >= 100 - REAL_FAIL_PERCENT) stat.realBlocked++; // a few real people fail the challenge
  }
  const perIp = new Array(BOT_IPS).fill(0);
  for (let i = 0; i < bots; i++) {
    stat.botIn++;
    const ip = random(BOT_IPS); random(BOT_FINGERPRINTS); // the bots use 3 fingerprints, all unknown
    if (++perIp[ip] > IP_LIMIT) { stat.botIpLimited++; continue; }
    if (challenge && random(100) >= BOT_PASS_PERCENT) { stat.botChallenged++; continue; }
    stat.botPassed++;
    if (!challenge) stat.botBefore++;
  }
}
console.log(`attack detected at second ${detectedAt}, challenge from second ${challengeFrom}`);
console.log(`bot requests: ${stat.botIn}; stopped by the per-IP limit: ${stat.botIpLimited}; stopped by the challenge: ${stat.botChallenged}; passed: ${stat.botPassed} (${stat.botBefore} before the challenge)`);
console.log(`real requests: ${stat.realIn}; blocked by mistake: ${stat.realBlocked}`);

const ok = scores.join('') === '025465' && detectedAt === 21 && stat.botPassed < stat.botIn * MAX_BOT_PASSED && stat.realBlocked < stat.realIn * MAX_REAL_BLOCKED && stat.botIpLimited === 0;
if (!ok) process.exit(1);
