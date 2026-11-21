// KISS, YAGNI and premature abstraction. Part 1 writes one report exporter twice (plain function vs. a registry, config and factory
// built for formats nobody asked for) and counts the calls one report goes through. Part 2 shows the case where planning ahead IS
// right: a stored record with a version field vs. one without. Part 3 counts the touch points of a year of 12 change requests
// (10 inside the code, 2 on the public contract) for three designs. Look for: 1 call vs 7, the old reader silently misreading a
// new record, and where speculation starts to pay (only at a 90% hit rate).
const trace = [];
const ROWS = [["tea", 3], ["milk", 12], ["rice", 40]];

// Part 1a. Simple: one function that does today's job.
function exportCsv(rows) {
  trace.push("export_csv");
  return rows.map(([n, q]) => `${n},${q}`).join("\n");
}

// Part 1b. Speculative: an exporter registry, a config file and a factory, for JSON and XML that were "bound to come".
function joinRow(cells) {
  trace.push("join_row");
  return cells.join(",");
}
function csvExporter(rows) {
  trace.push("csv_exporter");
  return rows.map(([n, q]) => joinRow([n, String(q)])).join("\n");
}
const REGISTRY = { csv: csvExporter }; // the json and xml exporters were planned, never written
const CONFIG = { format: "csv" };
function loadConfig() {
  trace.push("load_config");
  return CONFIG;
}
function getExporter(fmt) {
  trace.push("get_exporter");
  return REGISTRY[fmt];
}
function exportReport(rows) {
  trace.push("export_report");
  return getExporter(loadConfig().format)(rows);
}

const a = exportCsv(ROWS);
const callsSimple = trace.length;
const namesSimple = new Set(trace).size;
trace.length = 0;
const b = exportReport(ROWS);
console.log(`same output: ${a === b}`);
console.log(`calls for one report: simple ${callsSimple}, speculative ${trace.length}`);
console.log(`different names to read: simple ${namesSimple}, speculative ${new Set(trace).size}`);

// Part 2. Planning ahead that is right: a stored record. Files written today are read for years, by readers you cannot update.
function readV0(line) { // reads "qty,name"
  const i = line.indexOf(",");
  return `qty=${line.slice(0, i)} name=${line.slice(i + 1)}`;
}
function writeV2(qty, cur, name) { // a new field is added later
  return `v2|${qty}|${cur}|${name}`;
}
function readVersioned(line, newest) { // a reader that knows its versions and says so when it meets a newer one
  const p = line.split("|");
  if (p[0] === "v1" && newest >= 1) return `qty=${p[1]} name=${p[2]}`;
  if (p[0] === "v2" && newest >= 2) return `qty=${p[1]} cur=${p[2]} name=${p[3]}`;
  return `error: unknown version ${p[0]}`;
}
console.log("old reader, unversioned, new record 3,EUR,tea: " + readV0("3,EUR,tea"));
console.log("old reader, versioned, new record: " + readVersioned(writeV2(3, "EUR", "tea"), 1));
console.log("new reader, versioned, new record: " + readVersioned(writeV2(3, "EUR", "tea"), 2));

// Part 3. A year of 12 change requests: 10 inside the code, 2 on the public contract. Touch points = places a person must edit.
// simple:      build 3; an internal change 2 (edit, test); a contract change costs the "late" price L.
// speculative: build 3 + 6 (interface, registry, config, two exporters nobody asked for); a guessed change 1 (add a class),
//              a missed one 4 (the interface, the factory, every exporter, the config); a contract change costs L.
// targeted:    simple code, plus 2 points up front for a version field and a rule to reject unknown versions;
//              an internal change 2; a contract change 1 (add a version).
const INTERNAL = 10, CONTRACT = 2;
const SURFACES = [["internal function", 1], ["public API", 9], ["stored file format", 15]];

function year(design, hit, late) {
  if (design === "simple") return 3 + INTERNAL * 2 + CONTRACT * late;
  if (design === "speculative") {
    const h = Math.floor((INTERNAL * hit) / 100);
    return 9 + h * 1 + (INTERNAL - h) * 4 + CONTRACT * late;
  }
  return 5 + INTERNAL * 2 + CONTRACT * 1;
}

for (const [name, late] of SURFACES) {
  for (const hit of [0, 50, 90, 100]) {
    console.log(`${name}, guess right ${hit}%: simple ${year("simple", hit, late)}, ` +
      `speculative ${year("speculative", hit, late)}, targeted ${year("targeted", hit, late)}`);
  }
}
let first = -1;
for (let h = 0; h <= 100; h += 10) if (year("speculative", h, 1) <= year("simple", h, 1)) { first = h; break; }
console.log(`speculation matches simple from a hit rate of ${first}%`);
