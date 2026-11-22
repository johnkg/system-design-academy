// Least astonishment and interface design. Part 1 runs four real interfaces, each in a version that invites misuse and one that
// does not, against a caller who guessed from the names: positional boolean flags, a destructive default, a getter with a hidden
// side effect, and a name that hides an in-place change. Part 2 is a small model of 20 callers who read names only (level 0), the
// signature (level 1) or the docs (level 2), and counts mistaken calls and damage per design. Look for: each caller doing what
// the name suggested while the code did something else, and the over-explicit design that trades surprise for noise.

// 1. Positional boolean flags: the caller means header=yes, compress=no.
const ROWS = [["tea", 3], ["milk", 12]];

function exportBad(rows, compress, header) {
  const lines = rows.map(([n, q]) => `${n},${q}`);
  if (header) lines.unshift("name,qty");
  const s = lines.join("|");
  return compress ? "gz:" + s : s;
}
function exportGood(rows, { header = false, compress = false } = {}) {
  return exportBad(rows, compress, header);
}
console.log(`flags: export(rows, true, false) gave '${exportBad(ROWS, true, false)}'; named call gave ` +
  `'${exportGood(ROWS, { header: true, compress: false })}'`);

// 2. Surprising default: the caller deletes a directory they believe is empty.
function deleteBad(fs, path, recursive = true) {
  const gone = Object.keys(fs).filter((p) => p.startsWith(path + "/"));
  for (const p of gone) delete fs[p];
  return `deleted ${gone.length} files`;
}
function deleteGood(fs, path, recursive = false) {
  const inside = Object.keys(fs).filter((p) => p.startsWith(path + "/"));
  if (inside.length && !recursive) return `refused: ${inside.length} files inside`;
  for (const p of inside) delete fs[p];
  return `deleted ${inside.length} files`;
}
const fs1 = { "/a/x": "1", "/a/y": "2", "/b/z": "3" };
const fs2 = { ...fs1 };
const d1 = deleteBad(fs1, "/a"), d2 = deleteGood(fs2, "/a");
console.log(`default: delete('/a') ${d1}, ${Object.keys(fs1).length} left; safe default ${d2}, ${Object.keys(fs2).length} left`);

// 3. Hidden side effect: the caller checks whether a user exists.
function getUserBad(users, name) { // creates the user when missing
  if (!users.includes(name)) users.push(name);
  return name;
}
const findUser = (users, name) => (users.includes(name) ? name : null);
const u1 = ["ann", "bob", "cy"], u2 = ["ann", "bob", "cy"];
const e1 = getUserBad(u1, "zed") !== null;
const e2 = findUser(u2, "zed") !== null;
console.log(`side effect: get_user('zed') says exists ${e1} and users are now ${u1.length}; ` +
  `find_user says exists ${e2} and users stay ${u2.length}`);

// 4. A name that hides an in-place change: the caller expects a sorted copy.
function getSortedBad(xs) {
  xs.sort((a, b) => a - b);
  return xs;
}
const sortedCopy = (xs) => [...xs].sort((a, b) => a - b);
const l1 = [3, 1, 2], l2 = [3, 1, 2];
getSortedBad(l1);
sortedCopy(l2);
console.log(`name: after get_sorted the caller's list is ${l1.join(",")}; after sorted_copy it is ${l2.join(",")}`);

// Part 2. 20 callers per team, as counts at attention level 0 (names only), 1 (signature), 2 (documentation).
// A hazard is noticed only by a caller who reads at least `need` levels deep: flags need 1, the others 2.
// inviting: callers below `need` are surprised. least astonishing: the name, type or default shows the hazard, need 0.
// over-explicit: every option must be spelled out, so nobody is surprised by a default, but callers who only read names
//   paste the dangerous settings (weight 3 or more) from the nearest example.
const TEAMS = { careful: [0, 5, 15], mixed: [8, 8, 4], hurried: [16, 3, 1] };
const HAZARDS = [["flags", 1, 1], ["default", 2, 5], ["side effect", 2, 3], ["name", 2, 2]]; // [label, need, damage if it bites]
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function astonished(design, team, need, weight) {
  const counts = TEAMS[team];
  if (design === "inviting") return sum(counts.slice(0, need));
  if (design === "least") return 0;
  return weight >= 3 ? counts[0] : 0;
}
function words(design, flags, present) {
  if (design === "inviting") return 2 + (flags ? 2 : 0);
  return design === "least" ? 2 : 2 + 3 * present;
}

for (const team of ["careful", "mixed", "hurried"]) {
  for (const design of ["inviting", "least", "over"]) {
    const mistaken = sum(HAZARDS.map(([, n, w]) => astonished(design, team, n, w)));
    const damage = sum(HAZARDS.map(([, n, w]) => astonished(design, team, n, w) * w));
    console.log(`${team} team, ${design}: mistaken calls ${mistaken}, damage ${damage}, arguments per call ${words(design, true, 4)}`);
  }
}
for (const [name, need, weight] of HAZARDS) {
  const a = astonished("inviting", "mixed", need, weight);
  console.log(`mixed team, ${name} alone: ${a} surprised, damage ${a * weight}`);
}
