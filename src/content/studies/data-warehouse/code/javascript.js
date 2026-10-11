// A tiny column store with date partitions and zone maps, in JavaScript:
// rows are cut into partitions by day, each column is encoded on its own, and a query reads only the columns and partitions it needs.

const ROWS = 6000, DAYS = 30, PART_DAYS = 5, ROW_BYTES = 14; // a row store keeps day 4 + country 2 + qty 4 + amount 4 bytes together
const COUNTRIES = ['BR', 'DE', 'IN', 'JP', 'US'];
const COLUMNS = ['day', 'country', 'qty', 'amount'];

let seed = 7;
const next = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const bytesFor = (max) => (max < 256 ? 1 : max < 65536 ? 2 : 4); // the narrowest whole number of bytes that holds the biggest value

const rows = [];
for (let i = 0; i < ROWS; i++) {
  const country = next(5), qty = 1 + next(5), amount = 1 + next(500);
  rows.push({ day: Math.floor((i * DAYS) / ROWS), country, qty, amount }); // rows arrive in date order, as events do
}

// Cut into partitions by day. Inside a partition sort by country (the sort key), so equal countries sit in long runs.
const parts = [];
for (let p = 0; p < DAYS / PART_DAYS; p++) {
  const items = rows.filter((r) => Math.floor(r.day / PART_DAYS) === p).sort((a, b) => a.country - b.country);
  const n = items.length, days = items.map((r) => r.day);
  const minDay = Math.min(...days), maxDay = Math.max(...days); // the zone map of this partition
  let runs = 0;
  items.forEach((r, i) => { if (i === 0 || r.country !== items[i - 1].country) runs++; });
  const size = {
    day: bytesFor(maxDay - minDay) * n,                       // delta from the partition's first day
    country: runs * 3,                                        // run-length: 1 byte code + 2 bytes count per run
    qty: bytesFor(Math.max(...items.map((r) => r.qty))) * n,  // bit-packed to the width the values need
    amount: bytesFor(Math.max(...items.map((r) => r.amount))) * n,
  };
  parts.push({ minDay, maxDay, n, items, size });
}

// Read the wanted columns of the partitions that can hold days lo..hi. Returns bytes read and the matching rows.
function scan(want, lo, hi, prune) {
  let bytes = 0, scanned = 0, rowsRead = 0;
  const hit = [];
  for (const p of parts) {
    if (prune && (p.maxDay < lo || p.minDay > hi)) continue; // the zone map proves nothing here can match
    const inside = p.minDay >= lo && p.maxDay <= hi;           // every row matches, so the day column is not needed
    const need = prune && inside ? want : [...new Set([...want, 'day'])];
    bytes += need.reduce((s, c) => s + p.size[c], 0);
    scanned++; rowsRead += p.n;
    for (const r of p.items) if (r.day >= lo && r.day <= hi) hit.push(r);
  }
  return { bytes, scanned, rowsRead, hit };
}

console.log(`${ROWS} rows in ${parts.length} partitions of ${PART_DAYS} days`);
for (const c of COLUMNS) {
  const enc = parts.reduce((s, p) => s + p.size[c], 0);
  console.log(`column ${c}: ${ROWS * { day: 4, country: 2, qty: 4, amount: 4 }[c]} B raw -> ${enc} B encoded`);
}

const [LO, HI] = [17, 24];
const inRange = rows.filter((r) => r.day >= LO && r.day <= HI);
const queries = [
  { name: 'sum(amount)', want: ['amount'], answer: (hit) => String(hit.reduce((s, r) => s + r.amount, 0)), truth: inRange },
  { name: 'sum(amount) by country', want: ['country', 'amount'], truth: inRange,
    answer: (hit) => COUNTRIES.map((c, i) => `${c}=${hit.filter((r) => r.country === i).reduce((s, r) => s + r.amount, 0)}`).join(' ') },
  { name: 'select *', want: COLUMNS, truth: inRange, answer: (hit) => `${hit.length} rows, amount total ${hit.reduce((s, r) => s + r.amount, 0)}` },
];
const rowStore = ROWS * ROW_BYTES;
for (const q of queries) {
  const all = scan(q.want, LO, HI, false), pruned = scan(q.want, LO, HI, true);
  const result = q.answer(pruned.hit);
  console.log(`${q.name} where day ${LO}..${HI}: ${result}`);
  console.log(`  row store ${rowStore} B | row store, same partitions ${pruned.rowsRead * ROW_BYTES} B | columns ${all.bytes} B | columns + zone maps ${pruned.bytes} B (${pruned.scanned} of ${parts.length} partitions)`);
  if (result !== q.answer(q.truth) || result !== q.answer(all.hit)) process.exit(1); // same answer as a plain loop over the rows
  if (!(pruned.bytes < all.bytes && all.bytes < rowStore && pruned.scanned === 2)) process.exit(1);
}
