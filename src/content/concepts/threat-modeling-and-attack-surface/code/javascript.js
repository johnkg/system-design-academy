// Threat modeling for a toy photo-sharing app: a list of threats (one per data flow, tagged with a STRIDE letter),
// scored as likelihood x impact, and a list of fixes that each remove one or more threats.
// What to look for: a model drawn only around the easy-to-list public endpoints reports "0 risk left" while about half
// of the real risk is still there, and one fix can remove threats in two different flows.
// Everything is a fixed integer table, so the output never changes. Scores are 1 to 5 and are judgement calls, not measurements.

// scope 1 = public endpoints, 2 = adds data stores and internal services, 3 = adds admin, third parties, build, backups
const THREATS = [
  { id: "t1", flow: "login endpoint", stride: "S", like: 5, impact: 4, scope: 1 },
  { id: "t2", flow: "photo by id endpoint", stride: "I", like: 4, impact: 4, scope: 1 },
  { id: "t3", flow: "upload endpoint", stride: "D", like: 4, impact: 2, scope: 1 },
  { id: "t4", flow: "comment form", stride: "T", like: 3, impact: 3, scope: 1 },
  { id: "t5", flow: "import photo from URL", stride: "E", like: 3, impact: 5, scope: 2 },
  { id: "t6", flow: "app to database", stride: "I", like: 2, impact: 5, scope: 2 },
  { id: "t7", flow: "job queue to workers", stride: "T", like: 3, impact: 4, scope: 2 },
  { id: "t8", flow: "application logs", stride: "I", like: 4, impact: 3, scope: 2 },
  { id: "t9", flow: "admin panel", stride: "E", like: 3, impact: 5, scope: 3 },
  { id: "t10", flow: "dependencies and CI", stride: "T", like: 2, impact: 5, scope: 3 },
  { id: "t11", flow: "backup bucket", stride: "I", like: 2, impact: 5, scope: 3 },
  { id: "t12", flow: "who deleted a photo", stride: "R", like: 3, impact: 2, scope: 3 },
];
const FIXES = [
  { id: "F1", name: "MFA and login rate limits", cost: 3, removes: ["t1", "t9"] },
  { id: "F2", name: "owner check on every photo read", cost: 2, removes: ["t2"] },
  { id: "F3", name: "upload size and type limits", cost: 1, removes: ["t3"] },
  { id: "F4", name: "encode output", cost: 1, removes: ["t4"] },
  { id: "F5", name: "egress allow-list for the importer", cost: 2, removes: ["t5"] },
  { id: "F6", name: "least-privilege database account", cost: 2, removes: ["t6"] },
  { id: "F7", name: "authenticate service-to-service calls", cost: 3, removes: ["t7"] },
  { id: "F8", name: "scrub logs and keep an audit trail", cost: 2, removes: ["t8", "t12"] },
  { id: "F9", name: "pin dependencies, scope CI secrets", cost: 2, removes: ["t10"] },
  { id: "F10", name: "private, encrypted backup bucket", cost: 1, removes: ["t11"] },
];
const risk = (t) => t.like * t.impact;
const sum = (list) => list.reduce((a, t) => a + risk(t), 0);

// How to order the fixes: "value" = visible risk removed per unit of cost, "biggest" = fix the single worst threat first,
// "cheap" = cheapest first (the easy wins feel productive). Ties go to the fix listed first.
function order(visible, ranking) {
  const gain = (f) => sum(visible.filter((t) => f.removes.includes(t.id)));
  const top = (f) => Math.max(0, ...visible.filter((t) => f.removes.includes(t.id)).map(risk));
  const cmp = {
    value: (a, b) => gain(b) * a.cost - gain(a) * b.cost,
    biggest: (a, b) => top(b) - top(a),
    cheap: (a, b) => a.cost - b.cost,
  }[ranking];
  return FIXES.filter((f) => gain(f) > 0).sort((a, b) => cmp(a, b) || FIXES.indexOf(a) - FIXES.indexOf(b));
}

function run(scope, budget, ranking) {
  const visible = THREATS.filter((t) => t.scope <= scope);
  let left = budget;
  const picked = [];
  for (const f of order(visible, ranking)) if (f.cost <= left) { picked.push(f); left -= f.cost; }
  const gone = new Set(picked.flatMap((f) => f.removes));
  const realLeft = THREATS.filter((t) => !gone.has(t.id));
  const seenLeft = visible.filter((t) => !gone.has(t.id));
  return { picked, spent: budget - left, seenLeft: sum(seenLeft), realLeft: sum(realLeft), removed: sum(THREATS) - sum(realLeft) };
}

console.log(`threats: ${THREATS.length}, total risk ${sum(THREATS)}`);
for (let s = 1; s <= 3; s++) {
  const v = THREATS.filter((t) => t.scope <= s);
  console.log(`scope ${s}: ${v.length} threats seen, risk seen ${sum(v)}, risk not seen ${sum(THREATS) - sum(v)}`);
}
for (const ranking of ["value", "biggest", "cheap"]) {
  for (const budget of [5, 8, 19]) {
    for (let scope = 1; scope <= 3; scope++) {
      const r = run(scope, budget, ranking);
      const pct = Math.floor((100 * r.removed) / sum(THREATS));
      console.log(`${ranking} budget ${budget} scope ${scope}: spent ${r.spent}, model says left ${r.seenLeft}, really left ${r.realLeft}, removed ${r.removed} (${pct}%), fixes ${r.picked.map((f) => f.id).join(",")}`);
    }
  }
}
