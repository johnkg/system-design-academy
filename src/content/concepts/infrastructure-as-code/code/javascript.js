// Infrastructure as code in JavaScript: diff desired state against real state into a plan, apply it, and prove a second apply changes nothing.
// A resource key is "type.name"; its value is a flat map of attributes. Changing an immutable attribute forces replacement.

const IMMUTABLE = { vpc: ["cidr"], subnet: ["cidr"], server: ["image", "subnet"], db: ["engine"] };

const clone = (x) => JSON.parse(JSON.stringify(x));
const byOrdinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const canon = (state) => JSON.stringify(Object.keys(state).sort(byOrdinal).map((k) => [k, Object.entries(state[k]).sort((a, b) => byOrdinal(a[0], b[0]))]));

function diffAttrs(from, to) {
  const names = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort(byOrdinal);
  return names.filter((n) => from[n] !== to[n]).map((n) => [n, from[n] ?? "(none)", to[n] ?? "(none)"]);
}

function plan(desired, actual) {
  const keys = [...new Set([...Object.keys(desired), ...Object.keys(actual)])].sort(byOrdinal);
  const steps = [];
  for (const key of keys) {
    if (!(key in actual)) { steps.push({ action: "create", key, changes: [] }); continue; }
    if (!(key in desired)) { steps.push({ action: "destroy", key, changes: [] }); continue; }
    const changes = diffAttrs(actual[key], desired[key]);
    if (changes.length === 0) continue; // already matches: nothing to do
    const type = key.split(".")[0];
    const forced = changes.some(([name]) => IMMUTABLE[type].includes(name));
    steps.push({ action: forced ? "replace" : "update", key, changes });
  }
  return steps;
}

function apply(actual, steps, desired) {
  let calls = 0;
  for (const s of steps) {
    if (s.action === "destroy") { delete actual[s.key]; calls += 1; }
    else { actual[s.key] = clone(desired[s.key]); calls += s.action === "replace" ? 2 : 1; } // replace = destroy + create
  }
  return calls;
}

const SIGN = { create: "+", update: "~", replace: "-/+", destroy: "-" };
function show(steps) {
  if (steps.length === 0) console.log("  No changes. Real state matches the code.");
  for (const s of steps) {
    const why = s.changes.map(([n, a, b]) => `${n}: ${a} -> ${b}`).join(", ");
    console.log(`  ${SIGN[s.action]} ${s.action} ${s.key}${why ? ` (${why})` : ""}${s.action === "replace" ? " forces replacement" : ""}`);
  }
  const n = (a) => steps.filter((s) => s.action === a).length;
  console.log(`  Plan: ${n("create")} create, ${n("update")} update, ${n("replace")} replace, ${n("destroy")} destroy`);
}

function run(title, desired, actual) {
  console.log(title);
  const steps = plan(desired, actual);
  show(steps);
  const calls = apply(actual, steps, desired);
  console.log(`  applied with ${calls} API calls`);
  const again = plan(desired, actual);
  if (again.length !== 0 || apply(actual, again, desired) !== 0) throw new Error("apply is not idempotent");
  if (canon(actual) !== canon(desired)) throw new Error("real state differs from desired");
  console.log("  second apply: 0 changes");
}

const web = (size, image = "ami-1") => ({ size, image, subnet: "subnet.app" });
const db = (engine, storage) => ({ engine, storage });
const actual = {}; // nothing exists yet

const v1 = {
  "vpc.main": { cidr: "10.0.0.0/16" }, "subnet.app": { cidr: "10.0.1.0/24" },
  "server.web-1": web("small"), "server.web-2": web("small"), "db.main": db("postgres15", "20"),
};
run("1. first apply", v1, actual);

const v2 = clone(v1);
v2["server.web-1"].size = "medium"; // in place
delete v2["server.web-2"]; v2["server.web-3"] = web("small"); // a rename is a delete plus a create
v2["db.main"].engine = "postgres16"; // immutable: the database is replaced and its data is lost
run("2. edit the code", v2, actual);

actual["server.web-1"].size = "large"; // someone clicked in the console
run("3. drift: web-1 was resized by hand", v2, actual);
console.log("all invariants held");
