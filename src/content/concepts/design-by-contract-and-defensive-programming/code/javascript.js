// Design by contract and defensive programming. An order goes through four layers (api, service, pricing, ledger). The same 20
// requests run through five designs: no checks, check everything everywhere, a contract (validate user input at the boundary,
// one postcondition inside), the same contract with assertions switched off, and silent repair (clamp bad values and go on).
// Every check is counted. 14 requests are fine, 4 carry bad user input (a quantity outside 1..100) and 2 hit a bug in our own
// service (a legacy path multiplies the price by 100 by mistake). Look for: where each design catches things, how many
// checks it pays for, and which designs let a wrong record through. Part 2 runs the same model on 100 requests.
const LIMIT = 100000;
const LAYERS = ["api", "service", "pricing", "ledger"];
let checks = 0;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

function check(ok) { // every condition a design evaluates goes through here, so the cost is visible
  checks += 1;
  return ok;
}
function validAll(qty, price) { // three conditions, stops at the first one that fails
  return check(qty >= 1 && qty <= 100) && check(price >= 0 && price <= 10000) && check(qty * price >= 0 && qty * price <= LIMIT);
}
function clampAll(qty, price) { // three "checks" that repair instead of rejecting
  checks += 3;
  return [clamp(qty, 1, 100), clamp(price, 0, 10000)];
}

function api(design, qty, price, legacy, internals) {
  if (design === "everywhere" && !validAll(qty, price)) return ["error", "api"];
  if (design === "contract") { // precondition on user input: the caller (the outside world) must supply a sane order
    if (!(check(qty >= 1 && qty <= 100) && check(price >= 0 && price <= 10000))) return ["error", "api"];
  }
  if (design === "repair") [qty, price] = clampAll(qty, price);
  return service(design, qty, price, legacy, internals);
}
function service(design, qty, price, legacy, internals) {
  if (design === "everywhere" && !validAll(qty, price)) return ["error", "service"];
  if (design === "repair") [qty, price] = clampAll(qty, price);
  if (legacy) price = price * 100; // the bug: the legacy path mixes up units
  return pricing(design, qty, price, internals);
}
function pricing(design, qty, price, internals) {
  if (design === "everywhere" && !validAll(qty, price)) return ["error", "pricing"];
  if (design === "repair") {
    checks += 3;
    qty = clamp(qty, 1, 100);
    price = clamp(price, 0, 10000);
    return ledger(design, clamp(qty * price, 0, LIMIT), qty, price);
  }
  const total = qty * price;
  if (design === "contract" && internals && !check(total >= 0 && total <= LIMIT)) return ["error", "pricing"]; // postcondition of pricing
  return ledger(design, total, qty, price);
}
function ledger(design, total, qty, price) {
  if (design === "everywhere" && !validAll(qty, price)) return ["error", "ledger"];
  if (design === "repair") clampAll(qty, price);
  return ["record", total];
}

const VALID = [[2, 300], [1, 1500], [10, 250], [5, 999], [3, 4500], [40, 120], [7, 700], [12, 800], [1, 10000], [25, 400], [100, 1000],
  [6, 350], [8, 2200], [15, 640]];
const USER = [[0, 200], [-3, 500], [500, 20], [101, 50]];
const BUG = [[20, 150], [5, 400]];
const REQUESTS = [...VALID.map(([q, p]) => [q, p, 0, "ok"]), ...USER.map(([q, p]) => [q, p, 0, "user"]), ...BUG.map(([q, p]) => [q, p, 1, "bug"])];

const DESIGNS = [["trust", "trust", true], ["everywhere", "everywhere", true], ["contract", "contract", true],
  ["contract, assertions off", "contract", false], ["repair", "repair", true]];
const REAL = {};
for (const [label, design, internals] of DESIGNS) {
  checks = 0;
  const tally = { correct: 0, rejected: 0, "failed loudly": 0, wrong: 0 };
  const where = Object.fromEntries(LAYERS.map((n) => [n, 0]));
  for (const [qty, price, legacy, kind] of REQUESTS) {
    const expected = kind === "user" ? null : qty * price;
    const res = api(design, qty, price, legacy, internals);
    if (res[0] === "record") {
      tally[res[1] === expected ? "correct" : "wrong"] += 1;
    } else {
      tally[expected === null ? "rejected" : "failed loudly"] += 1;
      where[res[1]] += 1;
    }
  }
  REAL[label] = [tally.correct, tally.rejected, tally["failed loudly"], tally.wrong, checks].join(",");
  const stops = LAYERS.filter((n) => where[n]).map((n) => `${n} ${where[n]}`).join(", ");
  console.log(`${label}: correct ${tally.correct}, rejected ${tally.rejected}, failed loudly ${tally["failed loudly"]}, ` +
    `wrong ${tally.wrong}, checks ${checks}, stopped at: ${stops || "nowhere"}`);
}

// Part 2. The same model as counts, checked against the run above, then for 100 requests with u% bad user input and b% bugs of our own.
// checks: everywhere 12 per good request, 1 for a rejected one, 8 for a bug (api 3, service 3, pricing 2); contract 3, 1, 3;
// contract with assertions off 2, 1, 2; repair 12 for every request; trust none.
function model(design, u, b, internals, n = 100) {
  const user = Math.floor((n * u) / 100), bug = Math.floor((n * b) / 100);
  const ok = n - user - bug;
  if (design === "trust") return { correct: ok, rejected: 0, loud: 0, wrong: user + bug, checks: 0 };
  if (design === "everywhere") return { correct: ok, rejected: user, loud: bug, wrong: 0, checks: ok * 12 + user + bug * 8 };
  if (design === "contract" && internals) return { correct: ok, rejected: user, loud: bug, wrong: 0, checks: ok * 3 + user + bug * 3 };
  if (design === "contract") return { correct: ok, rejected: user, loud: 0, wrong: bug, checks: ok * 2 + user + bug * 2 };
  return { correct: ok, rejected: 0, loud: 0, wrong: user + bug, checks: n * 12 };
}

const same = DESIGNS.every(([lbl, d, i]) => {
  const r = model(d, 20, 10, i, 20);
  return [r.correct, r.rejected, r.loud, r.wrong, r.checks].join(",") === REAL[lbl];
});
console.log(`the model gives the same counts as the run: ${same}`);
for (const [u, b] of [[0, 0], [20, 10], [40, 20]]) {
  for (const [label, design, internals] of DESIGNS) {
    const r = model(design, u, b, internals);
    console.log(`${u}% bad input, ${b}% bugs, ${label}: correct ${r.correct}, wrong ${r.wrong}, checks ${r.checks}`);
  }
}
