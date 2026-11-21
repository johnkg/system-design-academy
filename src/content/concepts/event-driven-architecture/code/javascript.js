// Event-driven architecture: one "place an order" flow built four ways, with the same order data, the same outage and the same change.
// Look for: messages per order, hops until the customer gets an answer vs until the order is done, who the publisher can name, and orders lost or delayed in an outage.
// A message is [from, to, label, carriesOrder]. A hop is one message that causally follows another (it leaves a service that just received one).
// Assumptions: every hop costs 5 ms; Payments handles 3 orders per tick when it is up; 10 ticks of arrivals; the workflow gives up on an order after 2 ticks of waiting.
const HOP_MS = 5, CAPACITY = 3, ARRIVAL_TICKS = 10, OUTAGE_START = 3, PATIENCE = 2;

function direct() { // the order service calls each service in turn and waits for each reply
  const m = [];
  for (const s of ["Payments", "Inventory", "Shipping", "Notify", "Analytics"]) { m.push(["Orders", s, "call", true]); m.push([s, "Orders", "reply", false]); }
  return m;
}
function orchestrated() { // one workflow service sends the commands and waits for the replies
  const m = [["Orders", "Workflow", "start", true]];
  for (const s of ["Payments", "Inventory", "Shipping", "Notify", "Analytics"]) { m.push(["Workflow", s, "command", true]); m.push([s, "Workflow", "reply", false]); }
  m.push(["Workflow", "Orders", "done", false]);
  return m;
}
function choreography() { // each service publishes what happened, and others react
  return [
    ["Orders", "Payments", "OrderPlaced", true], ["Orders", "Analytics", "OrderPlaced", true], ["Orders", "Notify", "OrderPlaced", true],
    ["Payments", "Inventory", "PaymentTaken", true], ["Payments", "Analytics", "PaymentTaken", true],
    ["Inventory", "Shipping", "StockReserved", true],
    ["Shipping", "Notify", "Shipped", true], ["Shipping", "Analytics", "Shipped", true],
  ];
}
function everythingAnEvent() { // every step announces that it started and finished, and an audit service listens to all
  const m = [];
  for (const s of ["Payments", "Analytics", "Audit", "Notify"]) m.push(["Orders", s, "OrderPlaced", true]);
  const chain = ["Payments", "Inventory", "Shipping", "Notify"];
  chain.forEach((s, i) => {
    for (const w of ["Analytics", "Audit"]) m.push([s, w, "Started", false]);
    const next = i + 1 < chain.length ? [chain[i + 1]] : [];
    for (const w of next.concat(["Analytics", "Audit"])) m.push([s, w, "Done", true]);
  });
  return m;
}

const DESIGNS = [
  { name: "Direct calls", msgs: direct(), waits: true, named: true, driver: "Orders", flow: ["Orders"], fraudEdit: ["Orders"], fraudReview: [], outage: "fail" },
  { name: "Orchestrated commands", msgs: orchestrated(), waits: true, named: true, driver: "Workflow", flow: ["Workflow"], fraudEdit: ["Workflow"], fraudReview: [], outage: "patient" },
  { name: "Choreographed events", msgs: choreography(), waits: false, named: false, flow: ["Orders", "Payments", "Inventory", "Shipping", "Notify", "Analytics"], fraudEdit: ["Payments"], fraudReview: ["Analytics", "Notify"], outage: "queue" },
  { name: "Everything an event", msgs: everythingAnEvent(), waits: false, named: false, flow: ["Orders", "Payments", "Inventory", "Shipping", "Notify", "Analytics", "Audit"], fraudEdit: ["Payments"], fraudReview: ["Analytics", "Audit", "Notify"], outage: "queue" },
];

function depth(msgs) { // longest causal chain: a message follows an earlier one that arrived at its sender
  const d = [];
  msgs.forEach((m, j) => {
    d[j] = 1;
    for (let i = 0; i < j; i++) if (msgs[i][1] === m[0]) d[j] = Math.max(d[j], d[i] + 1);
  });
  return Math.max(...d);
}

function outage(mode, rate, down) { // orders arrive for ARRIVAL_TICKS ticks; Payments is down for `down` ticks from OUTAGE_START
  const isDown = (t) => t >= OUTAGE_START && t < OUTAGE_START + down;
  let queue = [], failed = 0, done = 0, high = 0, last = 0, maxWait = 0;
  for (let t = 0; t < 40; t++) {
    const arrivals = t < ARRIVAL_TICKS ? rate : 0;
    for (let k = 0; k < arrivals; k++) {
      if (mode === "fail" && isDown(t)) failed++;
      else if (mode === "fail") { done++; last = Math.max(last, t); }
      else queue.push(t);
    }
    if (mode === "patient") { const keep = queue.filter((a) => t - a <= PATIENCE); failed += queue.length - keep.length; queue = keep; }
    if (mode !== "fail" && !isDown(t)) {
      const n = Math.min(CAPACITY, queue.length);
      for (const a of queue.slice(0, n)) { done++; maxWait = Math.max(maxWait, t - a); last = Math.max(last, t); }
      queue = queue.slice(n);
    }
    high = Math.max(high, queue.length);
  }
  return [failed, done, high, maxWait, last];
}

for (const d of DESIGNS) {
  const hops = depth(d.msgs);
  const resp = d.waits ? hops : 1;
  const carriers = new Set(d.msgs.filter((m) => m[3]).flatMap((m) => [m[0], m[1]]));
  const named = d.named ? new Set(d.msgs.filter((m) => m[3] && m[0] === d.driver).map((m) => m[1])).size : 0;
  console.log(`== ${d.name}: messages per order ${d.msgs.length}; hops until the customer is answered ${resp} (${resp * HOP_MS} ms); hops until the order is done ${hops} (${hops * HOP_MS} ms)`);
  console.log(`  places that define the flow ${d.flow.length}; services edited to add a field to the order ${carriers.size}; consumers the publisher's own code names ${named}`);
  console.log(`  add a fraud check: files edited ${d.fraudEdit.length}, new files 1, subscribers to review ${d.fraudReview.length}`);
  for (const [rate, down] of [[2, 4], [3, 8]]) {
    const [failed, done, high, wait, last] = outage(d.outage, rate, down);
    console.log(`  Payments down ${down} ticks at ${rate} orders per tick: failed ${failed}, done ${done}, queue high-water ${high}, longest wait ${wait} ticks, last done at tick ${last}`);
  }
}
