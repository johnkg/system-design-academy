// Slowly changing dimensions: Type 1 overwrite vs Type 2 history, in JavaScript.
// Customers move between regions while sales continue. Days are 1..360; a row is valid for from <= day < to.
const REGIONS = ["North", "South", "East", "West"];
const INIT = ["North", "South", "East", "South", "West", "East", "North", "West"];
const DAYS = 360;
const FACTS = 200; // sales in the demo
const MIN_AMOUNT = 20; // sale amounts are 20..200
const AMOUNT_SPREAD = 181;
const DAY_KEY = 1000000; // event sort key: day * DAY_KEY + position
const FACT_AFTER_CHANGES = 100000; // on the same day, changes load before facts
// The change feed: effective day, arrival day, customer index, new region and tier.
const FEED = [
  { cust: 6, eff: 80, arrive: 80, region: "South", tier: "basic" },
  { cust: 1, eff: 100, arrive: 100, region: "West", tier: "basic" },
  { cust: 3, eff: 150, arrive: 250, region: "East", tier: "basic" }, // late-arriving: effective day 150, delivered on day 250
  { cust: 4, eff: 200, arrive: 200, region: "North", tier: "basic" },
  { cust: 0, eff: 200, arrive: 200, region: "North", tier: "basic" }, // redelivered, nothing changed
  { cust: 4, eff: 220, arrive: 220, region: "North", tier: "gold" }, // tier only: still a new version, because tier is tracked
  { cust: 6, eff: 270, arrive: 270, region: "East", tier: "basic" },
  { cust: 2, eff: 300, arrive: 300, region: "South", tier: "basic" },
];

let seed = 7; // 32-bit LCG so every language produces the same sales
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
const facts = [];
for (let id = 0; id < FACTS; id++) facts.push({ id, day: 1 + (next() % DAYS), cust: next() % INIT.length, amount: MIN_AMOUNT + (next() % AMOUNT_SPREAD) });

const hash = (rec) => { // hash of the tracked attributes only (FNV-1a, 32 bit)
  let h = 2166136261;
  for (const ch of `${rec.region}|${rec.tier}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};

function load(type, correctLate) {
  const rows = []; let nextSk = 1; let skipped = 0; let rekeyed = 0;
  INIT.forEach((region, cust) => rows.push({ sk: nextSk++, cust, region, tier: "basic", hash: hash({ region, tier: "basic" }), from: 1, to: null }));
  const covering = (cust, day) => rows.find((r) => r.cust === cust && r.from <= day && (r.to === null || day < r.to));
  const events = [
    ...FEED.map((c, i) => ({ key: c.arrive * DAY_KEY + i, change: c })),
    ...facts.map((f) => ({ key: f.day * DAY_KEY + FACT_AFTER_CHANGES + f.id, fact: f })),
  ].sort((a, b) => a.key - b.key);
  const factSk = new Map();
  for (const e of events) {
    if (e.change) {
      const c = e.change; const h = hash(c);
      if (type === 1) { // overwrite in place: no history
        const r = rows.find((x) => x.cust === c.cust);
        if (r.hash === h) skipped++; else Object.assign(r, { region: c.region, tier: c.tier, hash: h });
      } else { // Type 2: close the version that was open, insert the new one
        const vf = correctLate ? c.eff : c.arrive; // valid_from = when it became true, not when we heard
        const old = covering(c.cust, vf);
        if (old.hash === h) { skipped++; continue; }
        const row = { sk: nextSk++, cust: c.cust, region: c.region, tier: c.tier, hash: h, from: vf, to: old.to };
        old.to = vf; rows.push(row);
        for (const f of facts) // facts already loaded for that period point at the old version: re-key them
          if (f.cust === c.cust && factSk.has(f.id) && f.day >= row.from && (row.to === null || f.day < row.to)) { factSk.set(f.id, row.sk); rekeyed++; }
      }
    } else {
      const f = e.fact; // point-in-time lookup: the version valid on the sale date
      factSk.set(f.id, type === 1 ? rows.find((x) => x.cust === f.cust).sk : covering(f.cust, f.day).sk);
    }
  }
  const bySk = new Map(rows.map((r) => [r.sk, r]));
  return { rows, skipped, rekeyed, regionOf: (f) => bySk.get(factSk.get(f.id)).region };
}

const truthRegion = (f) => { // reality, from the feed alone (effective dates)
  let region = INIT[f.cust], best = 0;
  for (const c of FEED) if (c.cust === f.cust && c.eff <= f.day && c.eff >= best) { region = c.region; best = c.eff; }
  return region;
};
const revenue = (regionOf) => { const t = Object.fromEntries(REGIONS.map((r) => [r, 0])); for (const f of facts) t[regionOf(f)] += f.amount; return t; };
const show = (name, t) => console.log(`${name.padEnd(13)}${REGIONS.map((r) => `${r} ${String(t[r]).padStart(5)}`).join("  ")}`);
const same = (a, b) => REGIONS.every((r) => a[r] === b[r]);
const check = (ok, msg) => { if (!ok) { console.log("FAILED: " + msg); process.exit(1); } };

const truth = revenue(truthRegion);
const t1 = load(1, false), t2naive = load(2, false), t2fix = load(2, true);
show("true then", truth);
show("type 1", revenue(t1.regionOf));
show("type 2 naive", revenue(t2naive.regionOf));
show("type 2 fixed", revenue(t2fix.regionOf));
const wrong = (l) => facts.filter((f) => l.regionOf(f) !== truthRegion(f)).length;
console.log(`rows: type1=${t1.rows.length} type2naive=${t2naive.rows.length} type2fixed=${t2fix.rows.length}`);
console.log(`facts on the wrong version: type1=${wrong(t1)} type2naive=${wrong(t2naive)} type2fixed=${wrong(t2fix)}`);
console.log(`skipped unchanged records: ${t2fix.skipped}, facts re-keyed by the correction: ${t2fix.rekeyed}`);

check(same(revenue(t2fix.regionOf), truth), "type 2 with correction must match the true-at-the-time totals");
check(!same(revenue(t1.regionOf), truth), "type 1 must differ from the true-at-the-time totals");
check(wrong(t2naive) > 0, "a late change without correction must mis-join some facts");
for (const l of [t1, t2naive, t2fix]) for (let c = 0; c < INIT.length; c++) {
  const mine = l.rows.filter((r) => r.cust === c).sort((a, b) => a.from - b.from);
  check(mine.filter((r) => r.to === null).length === 1, "exactly one current row per customer");
  check(mine.every((r, i) => i === 0 || mine[i - 1].to === r.from), "versions must be contiguous");
}
console.log("all checks passed");
