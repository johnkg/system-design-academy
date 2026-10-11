// A miniature columnar file writer and reader: partitions, row groups, per-chunk min/max stats and column pruning.
const DAYS = 10, ROWS_PER_DAY = 300, RG_ROWS = 100, PAYLOAD = 40;
const COUNTRIES = ["US", "DE", "BRA", "IND", "JPN"];
let seed = 42;
const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296);

function makeRows(clustered) {
  seed = 42;
  const byDay = [];
  for (let d = 0; d < DAYS; d++) {
    const rows = [];
    for (let i = 0; i < ROWS_PER_DAY; i++) {
      const user = next() % 100000, country = COUNTRIES[next() % 5], amount = next() % 1000;
      rows.push({ day: d, user, country, amount, i });
    }
    if (clustered) rows.sort((a, b) => a.amount - b.amount || a.i - b.i); // sort inside the partition
    byDay.push(rows);
  }
  return byDay;
}

const bitsFor = (range) => { let b = 0; while (range > 0) { b++; range = Math.floor(range / 2); } return b; };
const packed = (n, bits) => Math.floor((n * bits + 7) / 8) + 8; // bit-packed values plus an 8-byte header

function encodeChunk(name, values) {
  const n = values.length;
  if (name === "country") { // dictionary encoding: distinct strings once, then small integer codes
    const dict = [...new Set(values)].sort();
    const dictBytes = dict.reduce((s, v) => s + v.length + 1, 0);
    return { bytes: dictBytes + packed(n, bitsFor(dict.length - 1)) };
  }
  if (name === "payload") return { bytes: PAYLOAD * n + 8 }; // opaque blob, stored plain
  const min = Math.min(...values), max = Math.max(...values); // frame of reference: store (value - min) in few bits
  return { bytes: packed(n, bitsFor(max - min)), min, max };
}

function writeFile(rows) { // one file per partition, split into row groups, one chunk per column
  const groups = [];
  for (let s = 0; s < rows.length; s += RG_ROWS) {
    const part = rows.slice(s, s + RG_ROWS), chunks = {};
    for (const c of ["user", "country", "amount", "payload"]) chunks[c] = encodeChunk(c, c === "payload" ? part.map(() => 0) : part.map((r) => r[c]));
    groups.push({ rows: part, chunks });
  }
  return { groups, footer: 100 + 48 * 4 * groups.length }; // the footer holds the schema and every chunk's offset and stats
}

const rowFormatBytes = (rows) => rows.reduce((s, r) => s + 4 + 2 + r.country.length + 1 + PAYLOAD, 0);

// SELECT sum(amount) FROM t WHERE day >= fromDay AND amount >= minAmount
function query(files, byDay, mode, fromDay, minAmount, cols) {
  let bytes = 0, sum = 0, groupsRead = 0, groupsTotal = 0;
  for (let d = fromDay; d < DAYS; d++) { // partition pruning: days before fromDay are never opened
    if (mode === "row") { bytes += rowFormatBytes(byDay[d]); byDay[d].forEach((r) => { if (r.amount >= minAmount) sum += r.amount; }); continue; }
    bytes += files[d].footer;
    for (const g of files[d].groups) {
      groupsTotal++;
      if (mode === "stats" && g.chunks.amount.max < minAmount) continue; // min/max says no row can match
      groupsRead++;
      for (const c of cols) bytes += g.chunks[c].bytes; // only the requested column chunks are read
      g.rows.forEach((r) => { if (r.amount >= minAmount) sum += r.amount; });
    }
  }
  return { bytes, sum, groupsRead, groupsTotal };
}

for (const clustered of [false, true]) {
  const byDay = makeRows(clustered), files = byDay.map(writeFile);
  console.log(`data ${clustered ? "sorted by amount inside each day" : "in arrival order"}`);
  const cases = [["all days, amount>=0", 0, 0], ["last 3 days, amount>=0", 7, 0], ["last 3 days, amount>=900", 7, 900]];
  for (const [label, from, min] of cases) {
    const r = query(files, byDay, "row", from, min), c = query(files, byDay, "columnar", from, min, ["amount"]), s = query(files, byDay, "stats", from, min, ["amount"]);
    if (r.sum !== c.sum || c.sum !== s.sum) { console.log("MISMATCH"); process.exit(1); }
    const pad = (x) => String(x).padStart(6);
    console.log(`  ${label.padEnd(26)} row ${pad(r.bytes)}  columnar ${pad(c.bytes)}  +stats ${pad(s.bytes)} (${s.groupsRead}/${s.groupsTotal} groups)  sum ${s.sum}`);
  }
}
