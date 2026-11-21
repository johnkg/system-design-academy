// Monolith, modular monolith and microservices: one shop (6 modules) cut into deployable units five ways, hit by the same four changes.
// Look for: deploys per change, teams that must release together, network calls per checkout, and how many modules fail when Payments misbehaves.
// A design says how modules map to deployables (together = one process), whether the database is shared, whether module internals leak to callers,
// whether callers have fallbacks, and how many separate services one module is split into (1 or 3: api, logic, store).
// Assumption for latency: every network call costs the same fixed number of milliseconds (here 2).
const MODULES = ["catalog", "cart", "orders", "payments", "shipping", "notify"];
const CHECKOUT = [["orders", "cart"], ["cart", "catalog"], ["orders", "payments"], ["orders", "shipping"], ["shipping", "notify"]]; // caller, callee
const LAYERS = ["api", "logic", "store"];

const DESIGNS = [
  { name: "Big ball monolith", together: true, sharedDb: true, leaky: true, split: 1, fallbacks: false },
  { name: "Modular monolith", together: true, sharedDb: false, leaky: false, split: 1, fallbacks: false },
  { name: "Microservices", together: false, sharedDb: false, leaky: false, split: 1, fallbacks: true },
  { name: "Distributed monolith", together: false, sharedDb: true, leaky: true, split: 1, fallbacks: false },
  { name: "Nanoservices", together: false, sharedDb: false, leaky: false, split: 3, fallbacks: false },
];

// kind: logic (private rule), contract (a field others read), schema (a table column), all (a platform upgrade)
const CHANGES = [
  { text: "change a price rule in Catalog", kind: "logic", module: "catalog", consumers: [] },
  { text: "add a field to the Orders contract", kind: "contract", module: "orders", consumers: ["payments", "shipping", "notify"] },
  { text: "rename a column in the Orders table", kind: "schema", module: "orders", consumers: [] },
  { text: "upgrade the web framework everywhere", kind: "all", module: "", consumers: [] },
];

const callersOf = (m) => CHECKOUT.filter((e) => e[1] === m).map((e) => e[0]);

// Edits as [module, layers touched]. Layers only matter when a module is split into 3 services.
function edits(d, c) {
  if (c.kind === "all") return MODULES.map((m) => [m, LAYERS]);
  if (c.kind === "logic") return [[c.module, ["logic"]]].concat(d.leaky ? callersOf(c.module).map((m) => [m, ["logic"]]) : []);
  if (c.kind === "contract") return [[c.module, LAYERS]].concat(c.consumers.map((m) => [m, ["logic"]]));
  return d.sharedDb ? MODULES.map((m) => [m, m === c.module ? ["logic", "store"] : ["logic"]]) : [[c.module, ["logic", "store"]]];
}
const deployable = (d, m, layer) => (d.together ? "app" : d.split === 1 ? m : m + "." + layer);

function analyse(d, c) {
  const es = edits(d, c);
  const units = new Set();
  for (const [m, layers] of es) for (const l of layers) units.add(deployable(d, m, l));
  const teams = d.together ? MODULES.length : es.length; // one team per module; a shared deployable makes every team wait
  return [es.length, units.size, teams];
}

function checkoutCalls(d) {
  if (d.together) return 0;
  const visited = new Set(CHECKOUT.flat());
  return CHECKOUT.length + (d.split === 3 ? 2 * visited.size : 0); // api -> logic -> store inside each module is 2 more calls
}

function failing(d) { // modules whose requests fail when Payments crashes or holds a lock
  if (d.together || d.sharedDb) return MODULES.length;
  const out = new Set(["payments"]);
  if (!d.fallbacks) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const [a, b] of CHECKOUT) if (out.has(b) && !out.has(a)) { out.add(a); grew = true; }
    }
  }
  return out.size;
}

const MS = 2;
for (const d of DESIGNS) {
  const calls = checkoutCalls(d);
  console.log(`== ${d.name}: ${calls} network calls per checkout (${calls * MS} ms at ${MS} ms each), ${failing(d)} of ${MODULES.length} modules fail when Payments misbehaves`);
  let tm = 0, td = 0, tt = 0;
  CHANGES.forEach((c, i) => {
    const [m, dp, t] = analyse(d, c);
    console.log(`  C${i + 1} ${c.text}: edit ${m} modules, ${dp} deploys, ${t} teams release together`);
    tm += m; td += dp; tt += t;
  });
  console.log(`  four changes: ${tm} modules edited, ${td} deploys, ${tt} team-releases`);
}
