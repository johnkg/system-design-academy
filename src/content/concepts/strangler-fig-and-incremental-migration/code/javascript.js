// Strangler fig: a legacy shop with 8 slices is replaced by a new system four ways, for a few shadow-traffic and ramp-up settings.
// Look for: days until real users reach the new system, the most traffic switched in one step, requests hit by bugs before they were noticed,
// bugs still silent after the migration, and how many data links cross the old/new boundary at the worst moment.
// Model: each slice has traffic (thousand requests a day) and hidden bugs (each fires on `rate` of every 1,000 requests of its slice).
// Shadow mode replays real requests to both systems and compares the answers: a bug is caught before any user sees it when it fires at least once in the replay.
// A ramp moves a share of a slice's traffic for one day per step. A monitor alerts when a bug hits 20 or more requests a day. Without rollback, fixing forward takes 5 days.
// Assumptions: building a slice takes 21 days (7 days for a slice a third the size), the team builds slices one after another, and ramp days overlap with the next build.
const ALERT = 20, FIX_FORWARD_DAYS = 5;
const SLICES = [ // name, traffic, bug rates
  ["accounts", 30, [40]], ["catalog", 120, [2]], ["search", 90, []], ["cart", 60, [15, 1]],
  ["checkout", 30, [50, 3]], ["orders", 24, [8]], ["invoices", 9, [30, 1]], ["reports", 6, []],
];
const LINKS = [[0, 3], [0, 4], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [5, 7], [6, 7]]; // slices that share data
const RAMPS = [["All at once", [100]], ["1% then everything", [1, 100]], ["1, 10, 50, 100", [1, 10, 50, 100]], ["10% steps", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]]];
const DESIGNS = [
  { name: "Big-bang rewrite", split: 1, shadow: true, ramp: false, rollback: false },
  { name: "Strangler with parity checks", split: 1, shadow: true, ramp: true, rollback: true },
  { name: "Strangler without parity checks", split: 1, shadow: false, ramp: true, rollback: true },
  { name: "Slices of one endpoint", split: 3, shadow: true, ramp: true, rollback: true },
];

function slicesOf(split) { // split each slice in `split` parts: traffic is shared out, bug i goes to part i % split
  const out = [];
  SLICES.forEach(([name, traffic, bugs], p) => {
    for (let j = 0; j < split; j++) out.push({ parent: p, part: j, name: split === 1 ? name : name + "." + (j + 1), traffic: traffic / split, bugs: bugs.filter((_, i) => i % split === j) });
  });
  return out;
}
function linksOf(split, slices) {
  if (split === 1) return LINKS;
  const idx = (p, j) => slices.findIndex((s) => s.parent === p && s.part === j);
  const out = [];
  for (const [a, b] of LINKS) for (let j = 0; j < split; j++) out.push([idx(a, j), idx(b, j)]);
  for (let p = 0; p < SLICES.length; p++) for (let j = 0; j + 1 < split; j++) out.push([idx(p, j), idx(p, j + 1)]);
  return out;
}
function peakCrossing(slices, links) { // slices move in order; count links with one end moved and the other not
  let peak = 0;
  for (let k = 1; k < slices.length; k++) peak = Math.max(peak, links.filter(([a, b]) => (a < k) !== (b < k)).length);
  return peak;
}

function run(d, shadowRequests, ramp) {
  const slices = slicesOf(d.split);
  const total = SLICES.reduce((s, x) => s + x[1], 0);
  const steps = d.ramp ? ramp : [100];
  const shadow = d.shadow ? shadowRequests : 0;
  let harm = 0, silent = 0, caught = 0, bugs = 0, widest = 0;
  for (const s of slices) {
    let prev = 0;
    for (const share of steps) { widest = Math.max(widest, Math.floor(((share - prev) * s.traffic) / total)); prev = share; }
    for (const rate of s.bugs) {
      bugs++;
      if (Math.floor((shadow * rate) / 1000) >= 1) { caught++; continue; }
      let noticed = false;
      for (const share of steps) {
        const hit = Math.floor((s.traffic * share * rate) / 100); // requests a day that fire the bug at this share
        if (hit >= ALERT) { harm += d.rollback ? hit : hit * FIX_FORWARD_DAYS; noticed = true; break; }
        harm += hit;
      }
      if (!noticed) silent++;
    }
  }
  const buildDays = d.split === 1 ? 21 : 7;
  const first = d.ramp ? buildDays : 21 * SLICES.length;
  const finish = d.ramp ? buildDays * slices.length + steps.length : 21 * SLICES.length + 1;
  return [first + 1, finish, d.ramp ? widest : 100, caught, bugs, harm, silent, peakCrossing(slices, d.ramp ? linksOf(d.split, slices) : []), d.ramp ? slices.length : 1];
}

for (const [shadow, rampIdx] of [[0, 2], [500, 2], [2000, 2], [500, 0]]) {
  console.log(`-- shadow ${shadow} requests per slice, ramp "${RAMPS[rampIdx][0]}"`);
  for (const d of DESIGNS) {
    const [first, finish, widest, caught, bugs, harm, silent, peak, routes] = run(d, shadow, RAMPS[rampIdx][1]);
    console.log(`  ${d.name}: first users on day ${first}, done on day ${finish}, widest step ${widest}% of all traffic, shadow caught ${caught} of ${bugs} bugs, requests hit before noticed ${harm}, bugs silent ${silent}, data links across the boundary at worst ${peak}, slices to route ${routes}`);
  }
}
