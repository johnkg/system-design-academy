// A feature-flag evaluator: kill switch, targeting rules, then a sticky percentage rollout.
// Hashing is FNV-1a 32-bit with explicit masking, so every language computes the same bucket.

const BUCKETS = 10000, BUCKETS_PER_PERCENT = BUCKETS / 100;
const USER_COUNT = 1000, STAFF_EVERY = 50; // every 50th user is staff
const COUNTRIES = ["US", "DE", "FR", "JP"];
const RESALT_PERCENT = 25;
const MIN_SEEN_AT_HALF = 300; // sanity floor for a 50% rollout

function fnv1a(text) {
  let hash = 2166136261; // offset basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0; // multiply, keep 32 bits
  }
  return hash >>> 0;
}

// Same user + same flag key + same salt => same bucket (0..9999), on every server, forever.
const bucket = (flag, userId) => fnv1a(`${flag.key}:${flag.salt}:${userId}`) % BUCKETS;

function evaluate(flag, user) {
  if (flag.killed) return { on: false, reason: "kill switch" };
  for (const rule of flag.rules) {
    if (user[rule.attr] === rule.equals) return { on: rule.serve, reason: `rule ${rule.attr}=${rule.equals}` };
  }
  const on = bucket(flag, user.id) < flag.percent * BUCKETS_PER_PERCENT; // percent in whole numbers: 25 -> buckets 0..2499
  return { on, reason: `rollout ${flag.percent}%` };
}

// If the flag service cannot be reached, use the last known value, else the safe default compiled into the code.
function evaluateSafely(fetchFlag, user, lastKnown, safeDefault = false) {
  try {
    return evaluate(fetchFlag(), user);
  } catch {
    return { on: lastKnown ?? safeDefault, reason: lastKnown === undefined ? "service down, safe default" : "service down, last known" };
  }
}

const users = [];
for (let i = 1; i <= USER_COUNT; i++) {
  users.push({ id: `user-${i}`, country: COUNTRIES[i % COUNTRIES.length], staff: i % STAFF_EVERY === 0 });
}
const flag = { key: "new-checkout", salt: "v1", percent: 0, killed: false, rules: [{ attr: "staff", equals: true, serve: true }, { attr: "country", equals: "DE", serve: false }] };
const seen = (f) => new Set(users.filter((u) => evaluate(f, u).on).map((u) => u.id));

console.log(`bucket(user-1)=${bucket(flag, "user-1")} bucket(user-2)=${bucket(flag, "user-2")}`);
let previous = new Set();
for (const percent of [0, 10, 25, 50, 100]) {
  const now = seen({ ...flag, percent });
  const droppedOut = [...previous].filter((id) => !now.has(id)).length; // stickiness: must stay 0
  console.log(`rollout ${String(percent).padStart(3)}%: ${now.size} of ${users.length} see it, ${droppedOut} dropped out`);
  if (droppedOut !== 0) process.exit(1);
  previous = now;
}

const salted = seen({ ...flag, percent: RESALT_PERCENT, salt: "v2" });
const kept = [...seen({ ...flag, percent: RESALT_PERCENT })].filter((id) => salted.has(id)).length;
console.log(`new salt at 25%: ${kept} of ${seen({ ...flag, percent: RESALT_PERCENT }).size} keep the feature (the cohort was reshuffled)`);

console.log(`killed: ${seen({ ...flag, percent: 100, killed: true }).size} see it`);
const down = () => { throw new Error("flag service unreachable"); };
const dave = users[4]; // user-5, in DE
const show = (r) => `{"on":${r.on},"reason":"${r.reason}"}`;
console.log(`service down, no cache: ${show(evaluateSafely(down, dave, undefined))}`);
console.log(`service down, cached on: ${show(evaluateSafely(down, dave, true))}`);
if (seen({ ...flag, percent: 100, killed: true }).size !== 0 || seen({ ...flag, percent: 50 }).size < MIN_SEEN_AT_HALF) process.exit(1);
