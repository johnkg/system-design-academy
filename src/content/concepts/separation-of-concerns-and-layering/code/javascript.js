// Separation of concerns and layering: one small app (orders, invoices, customers) built four ways, hit by the same five changes.
// Look for: files edited per change, edits that only forward data ("forwarding"), and unrelated behaviour ("bystanders") inside edited files.
// A layer is [name, what it holds, what it only passes along]. Every feature gets one file per layer, and each file calls the next layer down.
// Tokens: ui, rule, data (query shape), db (engine details), shape (the fields of a record, copied by every layer that maps it).
const FEATURES = ["orders", "invoices", "customers"];

const DESIGNS = [
  ["Leaky layers", [
    ["Controller", ["ui", "data"], ["shape"]], // the screen code knows column names
    ["Service", ["rule", "data"], ["shape"]], // the rules build queries
    ["Repository", ["data", "db"], ["shape"]],
  ]],
  ["Clean layers", [
    ["Controller", ["ui"], ["shape"]],
    ["Service", ["rule"], []],
    ["Repository", ["data", "db"], ["shape"]],
  ]],
  ["Vertical slices", [
    ["Slice", ["ui", "rule", "data", "db"], []],
  ]],
  ["Over-layered", [
    ["Controller", ["ui"], ["shape"]],
    ["Facade", [], ["shape"]],
    ["Service", ["rule"], ["shape"]],
    ["Manager", ["rule"], ["shape"]],
    ["DomainModel", [], ["shape"]],
    ["Repository", ["data"], ["shape"]],
    ["Dao", ["data", "db"], ["shape"]],
  ]],
];

const CHANGES = [
  ["add a field to the order screen", ["orders.ui", "orders.data", "orders.shape"]],
  ["change the order discount rule", ["orders.rule"]],
  ["rename an invoice column", ["invoices.data"]],
  ["swap the database engine", ["orders.db", "invoices.db", "customers.db"]],
  ["restyle every screen", ["orders.ui", "invoices.ui", "customers.ui"]],
];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

function build(layers) {
  const mods = [];
  for (const f of FEATURES) {
    layers.forEach(([layer, holds, passes], i) => {
      const name = cap(f) + layer;
      const nxt = i + 1 < layers.length ? cap(f) + layers[i + 1][0] : null;
      mods.push([name, holds.map((t) => f + "." + t), passes.map((t) => f + "." + t), nxt ? [nxt] : []]);
    });
  }
  return mods;
}

function analyse(mods, touches) {
  const edited = mods.filter((m) => m[1].concat(m[2]).some((t) => touches.includes(t)));
  const forwarding = edited.filter((m) => !m[1].some((t) => touches.includes(t)));
  let bystanders = 0;
  for (const m of edited) for (const t of m[1]) if (!touches.includes(t)) bystanders++;
  const retest = new Set(edited.map((m) => m[0]));
  let grew = true;
  while (grew) { // anything that calls a retested file must be retested too
    grew = false;
    for (const m of mods) {
      if (!retest.has(m[0]) && m[3].some((c) => retest.has(c))) { retest.add(m[0]); grew = true; }
    }
  }
  return [edited.map((m) => m[0]), forwarding.length, bystanders, retest.size];
}

for (const [name, layers] of DESIGNS) {
  const mods = build(layers);
  console.log(`== ${name}: ${mods.length} files, ${layers.length} files on the path of one request`);
  let te = 0, tf = 0, tb = 0, tr = 0;
  CHANGES.forEach(([text, touches], i) => {
    const [edited, fwd, by, rt] = analyse(mods, touches);
    console.log(`  C${i + 1} ${text}: edit ${edited.length} (${edited.join(", ")}); forwarding ${fwd}; bystander behaviours ${by}; retest ${rt}`);
    te += edited.length; tf += fwd; tb += by; tr += rt;
  });
  console.log(`  five changes: ${te} files edited, ${tf} forwarding edits, ${tb} bystander behaviours, ${tr} retests`);
}
