// A new app version (v4) ships on day 0 and users adopt it along a slowing curve, while 8% never update. A server change
// goes live on a chosen day; which of the 1,000,000 active users does it break? Integers only; the seed is fixed.
const USERS = 1000000;
const NEVER_PPM = 80000;                   // 8% of users never update (parts per million)
const BASE = [100000, 200000, 700000];     // day 0: users on v1, v2, v3 (v4 is released that day, with no users yet)
const NAMES = ['v1', 'v2', 'v3', 'v4'];
const STRICT_PARSER = 1;                   // v1 rejects a response that has a field it does not know

function makeRng(seed) { let s = seed; return () => { s = (s * 48271) % 2147483647; return s; }; }

// Each day a share of the users who are willing to update moves to v4. The share slows down: 16% on day 1, one point
// less each day, never below 1%, plus 0 or 1 point of daily noise. remaining[d] is the part per million of willing users
// still on an old version.
function adoption(days) {
  const next = makeRng(5);
  const remaining = [1000000];
  for (let d = 1; d <= days; d++) {
    const pct = Math.max(1, 16 - d) + (next() % 2);
    remaining.push(Math.floor((remaining[d - 1] * (100 - pct)) / 100));
  }
  return remaining;
}

// A share of all users in tenths of a percent, written with integers: 314414 users is "31.4%".
const percent = (users) => { const tenths = Math.floor((users * 1000) / USERS); return `${Math.floor(tenths / 10)}.${tenths % 10}%`; };

// Users on each of the four versions on a given day.
function versions(day) {
  const rem = adoption(day)[day];
  const keep = NEVER_PPM + Math.floor(((1000000 - NEVER_PPM) * rem) / 1000000); // part per million of each old version still there
  const old = BASE.map((u) => Math.floor((u * keep) / 1000000));
  return [...old, USERS - old.reduce((a, b) => a + b, 0)];
}

// change: 'additive' (a new field is sent), 'renamed' (a field gets a new name), 'removed' (a field is dropped).
// The old behaviour is removed on `day`. minVersion: clients below it get a forced-upgrade screen (1 = no minimum).
// adapt: the server reads the app-version header and keeps sending old clients the shape they know.
function run(change, day, minVersion, adapt) {
  const users = versions(day);
  const affected = change === 'additive' ? [STRICT_PARSER] : change === 'renamed' ? [1, 2, 3] : [2, 3]; // versions that read the field
  const forced = users.filter((_, i) => i + 1 < minVersion).reduce((a, b) => a + b, 0);
  const broken = adapt ? 0 : affected.filter((v) => v >= minVersion).reduce((a, v) => a + users[v - 1], 0);
  const shares = users.map((u, i) => `${NAMES[i]} ${percent(u)}`).join(', ');
  console.log(`${change} on day ${day}, minimum ${minVersion === 1 ? 'none' : NAMES[minVersion - 1]}, ${adapt ? 'adapting to the version header' : 'no adaptation'}`);
  console.log(`  users: ${shares}`);
  console.log(`  broken ${broken} of ${USERS} (${percent(broken)}); forced to upgrade ${forced}`);
}

run('renamed', 7, 1, false);
run('renamed', 14, 1, false);
run('renamed', 60, 1, false);
run('removed', 30, 1, false);
run('additive', 30, 1, false);
run('renamed', 30, 3, false);
run('renamed', 30, 1, true);
