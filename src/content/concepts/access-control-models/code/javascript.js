// A tiny ReBAC evaluator (relation tuples, userset rewrites, bounded graph walk) next to an RBAC check.
// Both must give the same answers as the intent: members view their team's docs, leads edit them,
// the contractor dave views one document, and alice's note is private.
const users = [["alice", "eng", "lead"], ["bob", "eng", "member"], ["carol", "finance", "lead"], ["dan", "finance", "member"], ["dave", "", "contractor"]];
const docs = [["eng/plan", "eng"], ["eng/spec", "eng"], ["finance/spec", "finance"], ["alice-notes", ""]];

// ---- ReBAC: tuples are [object, relation, subject] ----
const tuples = [
  ["group:eng", "member", "user:alice"], ["group:eng", "member", "user:bob"],
  ["group:finance", "member", "user:carol"], ["group:finance", "member", "user:dan"],
  ["folder:eng", "editor", "user:alice"], ["folder:eng", "viewer", "group:eng#member"],
  ["folder:finance", "editor", "user:carol"], ["folder:finance", "viewer", "group:finance#member"],
  ["folder:eng/specs", "parent", "folder:eng"], ["folder:finance/specs", "parent", "folder:finance"],
  ["doc:eng/plan", "parent", "folder:eng"], ["doc:eng/spec", "parent", "folder:eng/specs"],
  ["doc:finance/spec", "parent", "folder:finance/specs"],
  ["doc:eng/spec", "viewer", "user:dave"], ["doc:alice-notes", "editor", "user:alice"],
];
const index = new Map();
for (const t of tuples) index.set(t[0] + "#" + t[1], [...(index.get(t[0] + "#" + t[1]) || []), t]);
const fmt = (t) => `${t[0]}#${t[1]}@${t[2]}`;

// Rewrites: viewer = direct + editor + parent->viewer; editor = direct + parent->editor; group member = direct.
// Every tuple followed costs one hop, and the walk stops at maxDepth, so a cycle or a deep tree cannot run away.
function walk(obj, rel, user, used, maxDepth) {
  const own = index.get(obj + "#" + rel) || [];
  for (const t of own) if ((t[2] === "user:" + user || t[2] === "user:*") && used + 1 <= maxDepth) return [fmt(t)];
  for (const t of own) {
    if (!t[2].includes("#") || used + 1 > maxDepth) continue;
    const [g, r] = t[2].split("#");
    const sub = walk(g, r, user, used + 1, maxDepth);
    if (sub) return [fmt(t), ...sub];
  }
  if (obj.startsWith("group:")) return null;
  if (rel === "viewer") { const sub = walk(obj, "editor", user, used, maxDepth); if (sub) return sub; }
  for (const t of index.get(obj + "#parent") || []) {
    if (used + 1 > maxDepth) continue;
    const sub = walk(t[2], rel, user, used + 1, maxDepth);
    if (sub) return [fmt(t), ...sub];
  }
  return null;
}
const rebac = (user, act, doc, maxDepth = 8) => walk("doc:" + doc, act === "edit" ? "editor" : "viewer", user, 0, maxDepth);

// ---- RBAC: roles hold (action, pattern); users hold roles ----
const roles = { "eng-viewer": ["view", "eng/"], "eng-editor": ["edit", "eng/"], "finance-viewer": ["view", "finance/"], "finance-editor": ["edit", "finance/"], "eng-spec-viewer": ["view", "eng/spec"], "notes-owner": ["edit", "alice-notes"] };
const held = { alice: ["eng-editor", "notes-owner"], bob: ["eng-viewer"], carol: ["finance-editor"], dan: ["finance-viewer"], dave: ["eng-spec-viewer"] };
function rbac(user, act, doc) {
  for (const r of held[user] || []) {
    const [a, pat] = roles[r];
    if ((a === "edit" || act === "view") && (pat.endsWith("/") ? doc.startsWith(pat) : doc === pat)) return r;
  }
  return null;
}

function intended(user, act, doc) {
  const u = users.find((x) => x[0] === user), d = docs.find((x) => x[0] === doc);
  if (doc === "alice-notes") return user === "alice";
  if (u[1] && u[1] === d[1]) return act === "view" || u[2] === "lead";
  return user === "dave" && doc === "eng/spec" && act === "view";
}

const questions = [["alice", "edit", "eng/spec"], ["bob", "view", "eng/plan"], ["bob", "edit", "eng/plan"], ["dan", "view", "finance/spec"], ["dan", "view", "eng/plan"], ["dave", "view", "eng/spec"], ["dave", "view", "eng/plan"], ["bob", "view", "alice-notes"]];
for (const [u, a, d] of questions) {
  const p = rebac(u, a, d), r = rbac(u, a, d);
  console.log(`${u} ${a} ${d}: want=${intended(u, a, d) ? "allow" : "deny"} rebac=${p ? "allow" : "deny"} hops=${p ? p.length : 0} rbac=${r ? "allow" : "deny"} via ${r || "-"}`);
}
console.log("path: " + rebac("dan", "view", "finance/spec").join(" > "));
for (const depth of [3, 4]) console.log(`dan view finance/spec with depth ${depth}: ${rebac("dan", "view", "finance/spec", depth) ? "allow" : "deny (fail closed)"}`);

let pairs = 0;
for (const [u] of users) for (const [d] of docs) for (const a of ["view", "edit"]) {
  const want = intended(u, a, d);
  if (!!rebac(u, a, d) !== want || !!rbac(u, a, d) !== want) { console.log(`MISMATCH ${u} ${a} ${d}`); process.exit(1); }
  pairs++;
}
console.log(`${pairs} pairs agree; ${tuples.length} tuples vs ${Object.keys(roles).length} roles + ${Object.values(held).flat().length} assignments`);
