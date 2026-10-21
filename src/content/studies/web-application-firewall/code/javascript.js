// An anomaly-scoring web application firewall, in JavaScript:
// every rule that matches adds points, a rate rule adds more for a noisy client, and the total is compared with a threshold.
// In detection-only mode the verdict is logged but nothing is blocked.

// Each rule has a part of the request to look at, a text to find, and the points it adds.
const RULES = [
  { id: 'sqli-union', part: 'url', find: 'union select', points: 5 },
  { id: 'sqli-tautology', part: 'url', find: 'or 1=1', points: 5 },
  { id: 'xss-script', part: 'url', find: '<script', points: 5 },
  { id: 'path-traversal', part: 'url', find: '../', points: 4 },
  { id: 'sql-keyword', part: 'url', find: 'select ', points: 2 },
  { id: 'sql-comment', part: 'url', find: '--', points: 2 },
  { id: 'scanner-agent', part: 'agent', find: 'sqlmap', points: 5 },
  { id: 'script-agent', part: 'agent', find: 'python-requests', points: 2 },
];
const RATE_LIMIT = 3, RATE_POINTS = 3, WINDOW = 50; // more than 3 requests from one client in 50 requests adds 3 points

// Undo the common encodings first, otherwise "%2e%2e%2f" would hide a "../".
const normalise = (s) => s.toLowerCase().replaceAll('+', ' ').replaceAll('%27', "'").replaceAll('%3c', '<').replaceAll('%2e%2e%2f', '../');

function score(req, countFromClient) {
  const parts = { url: normalise(req.url), agent: req.agent.toLowerCase() };
  let total = 0;
  for (const rule of RULES) if (parts[rule.part].includes(rule.find)) total += rule.points;
  if (countFromClient > RATE_LIMIT) total += RATE_POINTS;
  return total;
}

// A seeded generator, so every run sees the same traffic.
const REQUESTS = 1000;
const ATTACK_FROM = 80; // r is 0..99: r >= 80 is an attack (20%)
const STRONG_UPTO = 92; // attacks: obvious payload below 92, evasive above
const NORMAL_UPTO = 70; // users: plain URL below 70, tricky but harmless above
const ATTACKERS = 3; // attacker client ids 1..3
const USER_ID_FROM = 10; // user client ids 10..59
const USERS = 50;
const DEFAULT_THRESHOLD = 5; // anomaly score that blocks

let seed = 77;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };
const pick = (list) => list[rnd(list.length)];

const NORMAL = ['/search?q=red+shoes', '/cart/add?id=42', '/products?page=3', '/account/orders'];
const TRICKY = ['/help?q=select+a+plan--annual', '/blog?q=how+to+select+a+laptop', '/search?q=a--b+select+size'];
const STRONG = ['/item?id=1+union+select+password+from+users--', '/c?q=%3cscript>alert(1)</script>', '/login?u=x%27+or+1=1'];
const EVASIVE = ['/item?id=1;select+sleep(5)', '/f?p=%2e%2e%2fetc/passwd', '/item?id=1+or+1=1'];
const BROWSER = 'Mozilla/5.0', BOT = 'python-requests/2.31';

const traffic = [];
const seen = new Map(); // requests per client in the current window
for (let i = 0; i < REQUESTS; i++) {
  if (i % WINDOW === 0) seen.clear();
  const r = rnd(100);
  const attack = r >= ATTACK_FROM;
  const req = attack
    ? { url: pick(r < STRONG_UPTO ? STRONG : EVASIVE), agent: rnd(2) ? BOT : BROWSER, client: 1 + rnd(ATTACKERS), attack }
    : { url: pick(r < NORMAL_UPTO ? NORMAL : TRICKY), agent: BROWSER, client: USER_ID_FROM + rnd(USERS), attack };
  seen.set(req.client, (seen.get(req.client) ?? 0) + 1);
  traffic.push({ ...req, points: score(req, seen.get(req.client)) });
}

function run(threshold, detectionOnly) {
  const o = { blockedAttacks: 0, blockedUsers: 0, missed: 0, wouldBlock: 0 };
  for (const t of traffic) {
    const flagged = t.points >= threshold;
    if (flagged) o.wouldBlock++;
    if (flagged && !detectionOnly) t.attack ? o.blockedAttacks++ : o.blockedUsers++;
    if (t.attack && !(flagged && !detectionOnly)) o.missed++;
  }
  return o;
}

console.log(`traffic: ${traffic.length} requests, ${traffic.filter((t) => t.attack).length} attacks`);
for (const threshold of [2, 4, 5, 8]) {
  const o = run(threshold, false);
  console.log(`threshold ${threshold}: blocked attacks ${o.blockedAttacks}, blocked real users ${o.blockedUsers}, attacks let through ${o.missed}`);
}
const watch = run(DEFAULT_THRESHOLD, true);
console.log(`detection only at 5: would block ${watch.wouldBlock}, blocked ${watch.blockedAttacks + watch.blockedUsers}`);

const strict = run(2, false), normal = run(DEFAULT_THRESHOLD, false), loose = run(8, false);
const ok = strict.blockedUsers > normal.blockedUsers && loose.missed > normal.missed && watch.blockedAttacks + watch.blockedUsers === 0 && normal.wouldBlock === watch.wouldBlock;
console.log(`stricter threshold blocks more real users, looser lets more attacks through: ${ok}`);
if (!ok) process.exit(1);
