// Dependency inversion: an order service that builds its own SMTP mailer and database, against one that OWNS the
// abstractions it needs and receives implementations. Part 1 runs both for real and counts calls that would leave the
// process. Part 2 is a small model of four codebases: it counts what a change touches. Look for: the high-level files
// touched when the mail provider is swapped, and how many tests need real infrastructure.
let realCalls = 0; // every call to SMTP or SQL
class SmtpMailer { notify(to, text) { realCalls++; } }
class SqlDatabase { save(order) { realCalls++; } }

// Hard-wired: the policy creates its own details.
class HardOrderService {
  constructor() { this.mailer = new SmtpMailer(); this.db = new SqlDatabase(); }
  place(order) {
    if (order.qty <= 0) return 'rejected';
    this.db.save(order);
    this.mailer.notify(order.email, `order ${order.id} placed`);
    return 'placed';
  }
}
// Owned abstraction: OrderService states what it needs (notify, save) in its own terms; details implement that.
class OrderService {
  constructor(notifier, store) { this.notifier = notifier; this.store = store; }
  place(order) {
    if (order.qty <= 0) return 'rejected';
    this.store.save(order);
    this.notifier.notify(order.email, `order ${order.id} placed`);
    return 'placed';
  }
}
class FakeNotifier { constructor() { this.sent = []; } notify(to, text) { this.sent.push(`${to}: ${text}`); } }
class FakeStore { constructor() { this.saved = 0; } save() { this.saved++; } }

const order = { id: 7, qty: 2, email: 'a@x.io' };
console.log(`hard-wired test: ${new HardOrderService().place(order)}, real calls ${realCalls}`);
realCalls = 0;
const notifier = new FakeNotifier(), store = new FakeStore();
console.log(`owned abstraction, fakes: ${new OrderService(notifier, store).place(order)}, real calls ${realCalls}, saved ${store.saved}, sent "${notifier.sent[0]}"`);
console.log(`production wiring: ${new OrderService(new SmtpMailer(), new SqlDatabase()).place(order)}, real calls ${realCalls}`);

// Part 2: the model. uses = what a file calls; impl = the interface a detail implements; tests = tests whose subject is the file.
const F = (name, kind, uses, tests, impl = '', rule = false) => ({ name, kind, uses, tests, impl, rule });
const SERVICES = ['OrderService', 'InvoiceService', 'ReminderService'];
const hard = [F('Program', 'root', SERVICES, 0), F('OrderService', 'policy', ['SmtpMailer', 'SqlDatabase'], 4, '', true),
  F('InvoiceService', 'policy', ['SmtpMailer', 'SqlDatabase'], 3), F('ReminderService', 'policy', ['SmtpMailer'], 2),
  F('SmtpMailer', 'infra', [], 1), F('SqlDatabase', 'infra', [], 1)];
const concrete = [F('Program', 'root', [...SERVICES, 'SmtpMailer', 'SqlDatabase'], 0), ...hard.slice(1)]; // same files, but handed in
const owned = [concrete[0], F('OrderService', 'policy', ['Notifier', 'OrderStore'], 4, '', true), F('InvoiceService', 'policy', ['Notifier', 'OrderStore'], 3),
  F('ReminderService', 'policy', ['Notifier'], 2), F('Notifier', 'interface', [], 0), F('OrderStore', 'interface', [], 0),
  F('SmtpMailer', 'infra', [], 1, 'Notifier'), F('SqlDatabase', 'infra', [], 1, 'OrderStore')];
const everything = [F('Program', 'root', [...SERVICES, 'SmtpMailer', 'SqlDatabase', 'SystemClock', 'OrderValidator', 'PriceCalculator', 'Money'], 0),
  F('OrderService', 'policy', ['Notifier', 'OrderStore', 'IValidator', 'IPriceCalculator', 'IClock'], 4),
  F('InvoiceService', 'policy', ['Notifier', 'OrderStore', 'IMoney', 'IClock'], 3), F('ReminderService', 'policy', ['Notifier', 'IClock'], 2),
  ...owned.slice(4), F('IClock', 'interface', [], 0), F('SystemClock', 'helper', [], 1, 'IClock'), F('IValidator', 'interface', [], 0),
  F('OrderValidator', 'helper', [], 1, 'IValidator'), F('IPriceCalculator', 'interface', [], 0), F('PriceCalculator', 'helper', ['IMoney'], 2, 'IPriceCalculator', true),
  F('IMoney', 'interface', [], 0), F('Money', 'helper', [], 1, 'IMoney')];
const DESIGNS = [['hard-wired', hard], ['DI of concrete types', concrete], ['owned abstraction', owned], ['interface for everything', everything]];

const get = (d, n) => d.find((f) => f.name === n);
const usersOf = (d, n) => d.filter((f) => f.uses.includes(n)).map((f) => f.name);
function usersClosure(d, names) { // every file that depends, directly or not, on one of names
  const out = new Set(names), todo = [...names];
  while (todo.length) for (const u of usersOf(d, todo.pop())) if (!out.has(u)) { out.add(u); todo.push(u); }
  return [...out];
}
// A test needs real infrastructure when its subject reaches a concrete infra class without passing an interface.
// (Subclass-mocking a concrete class is possible, but it keeps the test tied to the detail, so it is not counted.)
function reachesInfra(d, n) { const f = get(d, n); return f.kind === 'infra' || (f.kind !== 'interface' && f.uses.some((u) => reachesInfra(d, u))); }
// Files a reader opens on the longest call path from OrderService to a target (or to any leaf): an interface leads on to its implementers.
function layers(d, n, targets) {
  const f = get(d, n), next = [...f.uses, ...(f.kind === 'interface' ? d.filter((x) => x.impl === n).map((x) => x.name) : [])];
  const here = targets === null ? (next.length ? 0 : 1) : (targets.includes(n) ? 1 : 0);
  const deeper = next.map((m) => layers(d, m, targets)).filter((x) => x > 0).map((x) => x + 1);
  return Math.max(here, ...deeper, 0);
}
function change(d, kind) {
  let after = d, touched;
  if (kind === 'swap') { // the new provider has a different API: whoever names the old class directly must change
    touched = ['SendGridMailer', ...usersOf(d, 'SmtpMailer')];
    after = d.filter((f) => f.name !== 'SmtpMailer').map((f) => ({ ...f, uses: f.uses.map((u) => (u === 'SmtpMailer' ? 'SendGridMailer' : u)) }));
    after.push(F('SendGridMailer', 'infra', [], 1, get(d, 'SmtpMailer').impl));
  } else if (kind === 'test') { touched = ['NewOrderServiceTest']; after = d.map((f) => (f.name === 'OrderService' ? { ...f, tests: f.tests + 1 } : f)); }
  else { // the rule needs one more input: across an interface the signature changes too, and so do its callers
    const home = d.find((f) => f.rule), iface = home.impl && get(d, home.impl);
    touched = [home.name, ...(iface ? [iface.name, ...usersOf(d, iface.name)] : [])];
  }
  const rerun = kind === 'test' ? 1 : usersClosure(d, touched.filter((n) => get(d, n))).reduce((s, n) => s + get(d, n).tests, 0) + (kind === 'swap' ? 1 : 0);
  const focus = kind === 'swap' ? ['SendGridMailer'] : kind === 'rule' ? [d.find((f) => f.rule).name] : null;
  return { touched, policy: touched.filter((n) => get(after, n)?.kind === 'policy').length, rerun,
    infra: after.filter((f) => reachesInfra(after, f.name)).reduce((s, f) => s + f.tests, 0), layers: layers(after, 'OrderService', focus) };
}
const NAMES = { swap: 'swap the mail provider', test: 'add one test of OrderService', rule: 'change the high-level rule' };
for (const [label, d] of DESIGNS) {
  console.log(`-- ${label}: ${d.length} files, ${d.reduce((s, f) => s + f.tests, 0)} tests`);
  for (const kind of ['swap', 'test', 'rule']) {
    const r = change(d, kind);
    console.log(`  ${NAMES[kind]}: touches ${r.touched.length} (${r.touched.join(', ')}); policy files ${r.policy}; tests re-run ${r.rerun}; tests needing real infra ${r.infra}; layers ${r.layers}`);
  }
}
