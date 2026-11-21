// Domain-driven design: part 1 cuts a shop's "Customer" four ways and applies four changes; part 2 draws aggregate boundaries around five entities.
// Look for: files edited and teams involved per change, tests to run again, and which business rules one transaction can still enforce.
// A file is [name, team, what it holds, data fields it copies, files it imports]. A change touches tokens; a file is edited if it holds or copies one.
// Tokens: loyalty, address, payer, requester are the four teams' ideas of "customer"; ".data" is the model's fields, ".rule" is the code using them.
const ctx = (name, holds, copies) => [
  [name + "Model", name, holds, copies, []],
  [name + "Acl", name, [], holds.concat(copies), [name + "Model", "PublishedLanguage"]], // the translation layer maps shared ids into the context's own model
];

const DESIGNS = [
  ["One shared model", [
    ["CustomerModel", "shared", ["loyalty.data", "address.data", "payer.data", "requester.data"], [], []],
    ["SalesApp", "sales", ["loyalty.rule"], [], ["CustomerModel"]],
    ["ShippingApp", "shipping", ["address.rule"], [], ["CustomerModel"]],
    ["BillingApp", "billing", ["payer.rule"], [], ["CustomerModel"]],
    ["SupportApp", "support", ["requester.rule"], [], ["CustomerModel"]],
  ]],
  ["Contexts with translation", [
    ["PublishedLanguage", "shared", [], [], []],
    ...ctx("Sales", ["loyalty.data"], []),
    ...ctx("Shipping", ["address.data"], []),
    ...ctx("Billing", ["payer.data"], []),
    ...ctx("Support", ["requester.data"], []),
    ["SalesApp", "sales", ["loyalty.rule"], [], ["SalesModel"]],
    ["ShippingApp", "shipping", ["address.rule"], [], ["ShippingModel"]],
    ["BillingApp", "billing", ["payer.rule"], [], ["BillingModel"]],
    ["SupportApp", "support", ["requester.rule"], [], ["SupportModel"]],
  ]],
  ["Contexts reusing upstream types", [
    ["SalesModel", "sales", ["loyalty.data"], [], []],
    ["ShippingModel", "shipping", ["address.data"], [], []],
    ["BillingModel", "billing", ["payer.data"], [], []],
    ["SupportModel", "support", ["requester.data"], [], []],
    ["SalesApp", "sales", ["loyalty.rule"], [], ["SalesModel"]],
    ["ShippingApp", "shipping", ["address.rule"], ["loyalty.data"], ["ShippingModel", "SalesModel"]], // reads the Sales customer directly
    ["BillingApp", "billing", ["payer.rule"], ["loyalty.data"], ["BillingModel", "SalesModel"]],
    ["SupportApp", "support", ["requester.rule"], ["loyalty.data", "address.data"], ["SupportModel", "SalesModel", "ShippingModel"]],
  ]],
  ["A context per entity", [
    ["PublishedLanguage", "shared", [], [], []],
    ...ctx("Loyalty", ["loyalty.data"], []),
    ...ctx("Customer", [], ["loyalty.data", "address.data", "payer.data", "requester.data"]),
    ...ctx("Address", ["address.data"], []),
    ...ctx("Payment", ["payer.data"], []),
    ...ctx("Ticket", ["requester.data"], []),
    ...ctx("Order", [], ["loyalty.data", "address.data", "payer.data"]),
    ["SalesApp", "sales", ["loyalty.rule"], [], ["LoyaltyModel", "CustomerModel", "OrderModel"]],
    ["ShippingApp", "shipping", ["address.rule"], [], ["AddressModel", "CustomerModel", "OrderModel"]],
    ["BillingApp", "billing", ["payer.rule"], [], ["PaymentModel", "CustomerModel", "OrderModel"]],
    ["SupportApp", "support", ["requester.rule"], [], ["TicketModel", "CustomerModel"]],
  ]],
];

const CHANGES = [
  ["Sales adds a loyalty tier", ["loyalty.data", "loyalty.rule"]],
  ["Shipping allows several addresses", ["address.data", "address.rule"]],
  ["Billing separates payer from user", ["payer.data", "payer.rule"]],
  ["Support calls the customer a requester", ["requester.data", "requester.rule"]],
];

function analyse(files, touches) {
  const hit = (ts) => ts.some((t) => touches.includes(t));
  const edited = files.filter((f) => hit(f[2]) || hit(f[3]));
  const retest = new Set(edited.map((f) => f[0]));
  let grew = true;
  while (grew) { // anything that imports a retested file must be retested too
    grew = false;
    for (const f of files) if (!retest.has(f[0]) && f[4].some((c) => retest.has(c))) { retest.add(f[0]); grew = true; }
  }
  const teamsOf = (names) => new Set(files.filter((f) => names.has(f[0])).map((f) => f[1]));
  return [edited.map((f) => f[0]), teamsOf(new Set(edited.map((f) => f[0]))).size, retest.size, teamsOf(retest).size];
}

console.log("Part 1: one word, four meanings");
for (const [name, files] of DESIGNS) {
  console.log(`== ${name}: ${files.length} files`);
  let te = 0, tt = 0, tr = 0, tq = 0;
  CHANGES.forEach(([text, touches], i) => {
    const [edited, teams, retest, retestTeams] = analyse(files, touches);
    console.log(`  C${i + 1} ${text}: edit ${edited.length} (${edited.join(", ")}); ${teams} teams edit; retest ${retest} files of ${retestTeams} teams`);
    te += edited.length; tt += teams; tr += retest; tq += retestTeams;
  });
  console.log(`  four changes: ${te} files edited, ${tt} team-edits, ${tr} retests, ${tq} team-retests`);
}

// Part 2: aggregates. An invariant can be enforced in one transaction only if all its entities sit in one aggregate.
const INVARIANTS = [
  ["order total equals the sum of its lines", ["Order", "Line"]],
  ["a line quantity stays above zero", ["Line"]],
  ["stock never goes below zero", ["Line", "Stock"]],
  ["an order ships only when paid", ["Order", "Payment"]],
  ["open orders stay under the credit limit", ["Customer", "Order"]],
];
const AGGREGATES = [
  ["One big aggregate", [["Customer", "Order", "Line", "Payment", "Stock"]]],
  ["Order with its lines", [["Order", "Line"], ["Customer"], ["Payment"], ["Stock"]]],
  ["Every entity alone", [["Customer"], ["Order"], ["Line"], ["Payment"], ["Stock"]]],
];
console.log("Part 2: aggregates");
for (const [name, groups] of AGGREGATES) {
  const atomic = INVARIANTS.filter(([, es]) => groups.some((g) => es.every((e) => g.includes(e))));
  const biggest = Math.max(...groups.map((g) => g.length));
  console.log(`== ${name}: aggregates ${groups.length}; rules enforced in one transaction ${atomic.length} of ${INVARIANTS.length}; eventual ${INVARIANTS.length - atomic.length}; entities locked by the biggest write ${biggest}`);
}
