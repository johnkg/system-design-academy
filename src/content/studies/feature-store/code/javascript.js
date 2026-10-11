// A tiny feature store in JavaScript:
// one feature definition feeds an offline log and an online store, and training labels are joined "as of" their own time.

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Raw purchase events: the source of truth. Time only moves forward.
const events = [];
for (let i = 0, t = 0; i < 300; i++) { t += 1 + random(5); events.push({ user: random(6), ts: t, amount: 1 + random(100) }); }

// The single feature definition: per user, total spend and purchase count so far.
// The offline log and the online store both use it, so they cannot drift apart.
function computeRows(list) {
  const state = new Map(), rows = [];
  for (const e of list) {
    const s = state.get(e.user) ?? { sum: 0, count: 0 };
    s.sum += e.amount; s.count += 1; state.set(e.user, s);
    rows.push({ user: e.user, ts: e.ts, sum: s.sum, count: s.count });
  }
  return rows;
}

const offline = computeRows(events); // append-only history of every feature value, with the time it became true

// Online store: only the newest value per user. Delivery is out of order here, so a write with an older time is ignored.
const online = new Map();
const delivery = offline.slice();
for (let i = 0; i + 1 < delivery.length; i += 3) [delivery[i], delivery[i + 1]] = [delivery[i + 1], delivery[i]];
for (const r of delivery) { const cur = online.get(r.user); if (!cur || r.ts >= cur.ts) online.set(r.user, r); }

// Point-in-time join: the last row of this user whose time is at or before the label time (binary search).
function asOf(user, ts) {
  const rows = offline.filter((r) => r.user === user);
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].ts <= ts) lo = mid + 1; else hi = mid; }
  return lo === 0 ? { sum: 0, count: 0 } : rows[lo - 1];
}
// The naive join takes the newest row, which includes the future.
const latest = (user) => online.get(user);

// Ground truth, recomputed from the raw events seen up to the label time.
const truth = (user, ts) => events.filter((e) => e.user === user && e.ts <= ts).reduce((a, e) => ({ sum: a.sum + e.amount, count: a.count + 1 }), { sum: 0, count: 0 });

const labels = Array.from({ length: 40 }, () => ({ user: random(6), ts: 50 + random(700) }));
let naiveWrong = 0, pitWrong = 0;
for (const l of labels) {
  const t = truth(l.user, l.ts), p = asOf(l.user, l.ts), n = latest(l.user);
  if (p.sum !== t.sum || p.count !== t.count) pitWrong++;
  if (n.sum !== t.sum || n.count !== t.count) naiveWrong++;
}
const l0 = labels[1];
console.log(`events: ${events.length}, feature rows: ${offline.length}, online keys: ${online.size}`);
console.log(`label 1 (user ${l0.user} at t=${l0.ts}): truth sum ${truth(l0.user, l0.ts).sum}, as-of ${asOf(l0.user, l0.ts).sum}, naive latest ${latest(l0.user).sum}`);
console.log(`labels with a wrong feature: as-of ${pitWrong}, naive latest ${naiveWrong} of ${labels.length}`);

const same = [...online].every(([u, r]) => r.sum === offline.filter((x) => x.user === u).at(-1).sum);
const again = JSON.stringify(computeRows(events)) === JSON.stringify(offline); // a backfill from the raw events gives the same table
console.log(`online equals the newest offline row: ${same}; backfill repeats exactly: ${again}`);
if (pitWrong !== 0 || naiveWrong === 0 || !same || !again) process.exit(1);
