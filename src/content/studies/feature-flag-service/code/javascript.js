// A feature flag SDK in JavaScript: it evaluates from a cached ruleset with no network call,
// buckets users with a hash of the flag's salt and the user id, and keeps its last ruleset when the service is down.

// A 32-bit hash (FNV-1a followed by a final mix) of text, so the same user and flag always give the same number.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
const bucket = (salt, userId) => hash(`${salt}:${userId}`) % 10000; // 0..9999, in hundredths of a percent

// The order is: kill switch, then targeting rules, then the percentage rollout. A flag that does not exist is off.
function evaluate(ruleset, key, user) {
  const flag = ruleset && ruleset.flags[key];
  if (!flag || flag.killed) return false;
  for (const rule of flag.rules) if (user[rule.attr] === rule.equals) return rule.value;
  return bucket(flag.salt, user.id) < flag.rolloutBp;
}

class Sdk {
  constructor() { this.ruleset = null; }
  // A poll or a pushed message. A failed fetch (null) and an older version are both ignored, so the last good ruleset stays.
  apply(next) { if (next && (!this.ruleset || next.version > this.ruleset.version)) this.ruleset = next; }
  isOn(key, user) { return evaluate(this.ruleset, key, user); }
}

const makeRuleset = (version, rolloutBp, salt, killed) => ({
  version,
  flags: { 'new-checkout': { salt, killed, rolloutBp, rules: [{ attr: 'plan', equals: 'internal', value: true }] } },
});
const users = Array.from({ length: 20000 }, (_, i) => ({ id: `user-${i}`, plan: i % 100 === 0 ? 'internal' : 'free' }));
const count = (sdk, key) => users.filter((u) => sdk.isOn(key, u)).length;

const sdk = new Sdk();
console.log(`no ruleset yet, fail closed: ${count(sdk, 'new-checkout')} users on`);
sdk.apply(makeRuleset(1, 1000, 'nc-7f3a', false));
const at10 = users.filter((u) => sdk.isOn('new-checkout', u));
console.log(`10% rollout: ${at10.length} users on`);
sdk.apply(makeRuleset(2, 3000, 'nc-7f3a', false));
const at30 = users.filter((u) => sdk.isOn('new-checkout', u));
const kept = at10.filter((u) => sdk.isOn('new-checkout', u)).length;
console.log(`30% rollout: ${at30.length} users on, ${kept} of the first ${at10.length} kept it`);

const resalted = new Sdk(); resalted.apply(makeRuleset(3, 3000, 'nc-new-salt', false));
const lost = at10.filter((u) => !resalted.isOn('new-checkout', u)).length;
console.log(`same 30% with a new salt: ${lost} of the first ${at10.length} lose it`);

const other = users.filter((u) => bucket('other-flag', u.id) < 3000).length;
const both = users.filter((u) => bucket('other-flag', u.id) < 3000 && bucket('nc-7f3a', u.id) < 3000).length;
console.log(`two flags at 30% with different salts: ${both} of ${other} share users`);

sdk.apply(null);                              // the service is down: the last ruleset stays
sdk.apply(makeRuleset(1, 9000, 'nc-7f3a', false)); // an old version arrives late: ignored
console.log(`service down, old copy kept: version ${sdk.ruleset.version}, ${count(sdk, 'new-checkout')} users on`);
sdk.apply(makeRuleset(4, 3000, 'nc-7f3a', true));
console.log(`kill switch: ${count(sdk, 'new-checkout')} users on`);

const monotone = kept === at10.length && at30.length > at10.length;
const killed = count(sdk, 'new-checkout') === 0;
if (!monotone || !killed || lost === 0 || at10.length < 1500) process.exit(1);
