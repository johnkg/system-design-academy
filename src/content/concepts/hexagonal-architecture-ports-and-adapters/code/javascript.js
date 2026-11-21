// Hexagonal architecture: one order service built four ways, hit by the same four changes.
// Look for: files edited per change, unrelated behaviour ("bystanders") inside edited files, tests to run again, and how much infrastructure the rule tests need.
// A file is [name, what it holds, shape fields it copies, files it imports]. A change touches tokens; a file is edited if it holds or copies one.
// Tokens: rule (business rule), db (how the database is used), vendor (payment vendor details), mail, entry (HTTP details),
// port (the interfaces the core defines), shape (the fields of an order, copied by every file that maps it), wiring (what is plugged into what).
// The "Direct calls" design has no wiring file: its use cases construct the clients themselves.
const DESIGNS = [
  ["Direct calls", [
    ["HttpHandler", ["entry"], ["shape"], ["PlaceOrder", "CancelOrder", "OrderReport"]],
    ["PlaceOrder", ["rule", "db", "vendor", "mail"], ["shape"], ["SqlStore", "VendorClient", "MailClient"]],
    ["CancelOrder", ["rule", "db", "vendor", "mail"], [], ["SqlStore", "VendorClient", "MailClient"]],
    ["OrderReport", ["db"], [], ["SqlStore"]],
    ["SqlStore", ["db"], ["shape"], []],
    ["VendorClient", ["vendor"], [], []],
    ["MailClient", ["mail"], [], []],
  ]],
  ["Ports and adapters", [
    ["HttpAdapter", ["entry"], ["shape"], ["PlaceOrder", "CancelOrder", "OrderReport"]],
    ["PlaceOrder", ["rule"], [], ["Ports", "Order"]],
    ["CancelOrder", ["rule"], [], ["Ports", "Order"]],
    ["OrderReport", [], [], ["Ports"]],
    ["Order", [], ["shape"], []],
    ["Ports", ["port"], [], ["Order"]],
    ["SqlAdapter", ["db"], ["shape"], ["Ports", "Order"]],
    ["VendorAdapter", ["vendor"], [], ["Ports"]],
    ["MailAdapter", ["mail"], [], ["Ports"]],
    ["Main", ["wiring"], [], ["HttpAdapter", "SqlAdapter", "VendorAdapter", "MailAdapter", "PlaceOrder", "CancelOrder", "OrderReport"]],
  ]],
  ["Ports shaped like the vendor", [
    ["HttpAdapter", ["entry"], ["shape"], ["PlaceOrder", "CancelOrder", "OrderReport"]],
    ["PlaceOrder", ["rule", "vendor"], [], ["Ports", "Order"]], // the use case reads the vendor's status codes
    ["CancelOrder", ["rule", "vendor"], [], ["Ports", "Order"]],
    ["OrderReport", [], [], ["Ports"]],
    ["Order", [], ["shape"], []],
    ["Ports", ["port", "vendor"], [], ["Order"]], // the port copies the vendor's method names and flags
    ["SqlAdapter", ["db"], ["shape"], ["Ports", "Order"]],
    ["VendorAdapter", ["vendor"], [], ["Ports"]],
    ["MailAdapter", ["mail"], [], ["Ports"]],
    ["Main", ["wiring"], [], ["HttpAdapter", "SqlAdapter", "VendorAdapter", "MailAdapter", "PlaceOrder", "CancelOrder", "OrderReport"]],
  ]],
  ["Everything behind a port", [
    ["HttpAdapter", ["entry"], ["shape"], ["RequestMapper"]],
    ["RequestMapper", [], ["shape"], ["PlaceOrder", "CancelOrder", "OrderReport"]],
    ["PlaceOrder", ["rule"], ["shape"], ["Ports", "Order"]],
    ["CancelOrder", ["rule"], [], ["Ports", "Order"]],
    ["OrderReport", [], [], ["Ports"]],
    ["Order", [], ["shape"], []],
    ["Ports", ["port"], [], ["Order"]],
    ["ClockPort", [], [], []],
    ["IdPort", [], [], []],
    ["LoggerPort", [], [], []],
    ["PersistenceMapper", [], ["shape"], ["Order", "PersistenceModel"]],
    ["PersistenceModel", [], ["shape"], []],
    ["SqlAdapter", ["db"], ["shape"], ["Ports", "PersistenceMapper", "PersistenceModel"]],
    ["VendorAdapter", ["vendor"], [], ["Ports"]],
    ["MailAdapter", ["mail"], [], ["Ports"]],
    ["Main", ["wiring"], [], ["HttpAdapter", "SqlAdapter", "VendorAdapter", "MailAdapter", "PlaceOrder", "CancelOrder", "OrderReport"]],
  ]],
];

const CHANGES = [
  ["swap the database engine", ["db", "wiring"]],
  ["switch payment vendor", ["vendor", "wiring"]],
  ["change the free-shipping rule", ["rule"]],
  ["add a field to an order", ["shape"]],
];

function analyse(files, touches) {
  const hit = (ts) => ts.some((t) => touches.includes(t));
  const edited = files.filter((f) => hit(f[1]) || hit(f[2]));
  let bystanders = 0;
  for (const f of edited) for (const t of f[1]) if (!touches.includes(t)) bystanders++;
  const retest = new Set(edited.map((f) => f[0]));
  let grew = true;
  while (grew) { // anything that imports a retested file must be retested too
    grew = false;
    for (const f of files) if (!retest.has(f[0]) && f[3].some((c) => retest.has(c))) { retest.add(f[0]); grew = true; }
  }
  return [edited.map((f) => f[0]), bystanders, retest.size];
}

function infraNeededForRuleTests(files) { // files holding db, vendor or mail that PlaceOrder reaches through imports
  const byName = new Map(files.map((f) => [f[0], f]));
  const seen = new Set(["PlaceOrder"]);
  const todo = ["PlaceOrder"];
  while (todo.length) for (const i of byName.get(todo.pop())[3]) if (!seen.has(i)) { seen.add(i); todo.push(i); }
  const isInfra = (f) => f[1].some((t) => ["db", "vendor", "mail"].includes(t)) && !f[1].includes("port") && !f[1].includes("rule");
  return [...seen].filter((n) => isInfra(byName.get(n))).length;
}

for (const [name, files] of DESIGNS) {
  console.log(`== ${name}: ${files.length} files, ${infraNeededForRuleTests(files)} infrastructure files needed to test the rule`);
  let te = 0, tb = 0, tr = 0;
  CHANGES.forEach(([text, touches], i) => {
    const [edited, by, rt] = analyse(files, touches);
    console.log(`  C${i + 1} ${text}: edit ${edited.length} (${edited.join(", ")}); bystander behaviours ${by}; retest ${rt}`);
    te += edited.length; tb += by; tr += rt;
  });
  console.log(`  four changes: ${te} files edited, ${tb} bystander behaviours, ${tr} retests`);
}
