// IDOR (broken object-level authorization) in a toy invoice API with 8 endpoints and 20 invoices owned by 4 users.
// The attacker, bob (user 2), is logged in correctly. He owns 5 invoices and tries to reach the other 15.
// What to look for: "logged in" is not "allowed to see this object"; random ids hide the objects only until one endpoint
// (a list, a search, a bulk export, a leaked link) shows an id; checking a few handlers leaves the others open; and
// checking every row after fetching all rows is safe but reads the whole table.
// Fixed data and a seeded integer generator: the output never changes.

const OWNER = (i) => (i % 4) + 1;       // invoice i belongs to user (i mod 4) + 1
const BOB = 2;
let state = 777;
const next = () => (state = (state * 48271) % 2147483647); // MINSTD: the same sequence in every language
const hex6 = () => (next() % 16777216).toString(16).padStart(6, "0");

const ids = (kind) => {
  if (kind === "sequential") return Array.from({ length: 20 }, (_, i) => String(1001 + i));
  state = 777;
  return Array.from({ length: 20 }, hex6);
};
const ENDPOINTS = [
  { id: "E1", name: "GET /invoices/{id}", kind: "id", effect: "read" },
  { id: "E2", name: "PUT /invoices/{id}", kind: "id", effect: "change" },
  { id: "E3", name: "DELETE /invoices/{id}", kind: "id", effect: "delete" },
  { id: "E4", name: "GET /invoices/{id}/pdf", kind: "id", effect: "read" },
  { id: "E5", name: "GET /invoices (list)", kind: "list", effect: "read" },
  { id: "E6", name: "GET /search?q=", kind: "list", effect: "read" },
  { id: "E7", name: "POST /invoices/export {ids}", kind: "id", effect: "read" },
  { id: "E8", name: "GET /users/{userId}/invoices", kind: "list", effect: "read" },
];
// Which endpoints verify that the invoice is bob's (or, for lists, scope the query to bob).
const CHECKED = {
  none: [],
  "scoped-lists": ["E5", "E6", "E8"],
  some: ["E1", "E2", "E3"],
  central: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
  perrow: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
};

function attack(auth, idKind, leaked) {
  const invoiceIds = ids(idKind);
  const foreign = invoiceIds.filter((_, i) => OWNER(i) !== BOB);
  // Guessing: sequential ids are all guessable; for random ids bob tries 2000 random 6-digit hex values.
  let guessed;
  if (idKind === "sequential") guessed = foreign;
  else {
    const tries = new Set(Array.from({ length: 2000 }, hex6));
    guessed = foreign.filter((id) => tries.has(id));
  }
  const candidates = new Set(guessed);
  if (leaked) candidates.add(foreign[0]); // one id seen in a shared link or a log line
  const open = (e) => !CHECKED[auth].includes(e.id);
  for (const e of ENDPOINTS) if (e.kind === "list" && open(e)) foreign.forEach((id) => candidates.add(id)); // lists show ids
  // What one endpoint lets bob reach: a list shows every foreign invoice when unchecked, an id endpoint takes any id he has.
  const reach = (e) => (!open(e) ? [] : e.kind === "list" ? foreign : [...candidates]);
  const exposed = {};
  for (const e of ENDPOINTS) exposed[e.id] = reach(e).length;
  const count = (effect) => new Set(ENDPOINTS.filter((e) => e.effect === effect).flatMap(reach)).size;
  return { exposed, read: count("read"), change: count("change"), del: count("delete"), guessedValid: guessed.length };
}

console.log("bob owns 5 of 20 invoices; the other 15 belong to other users");
for (const auth of ["none", "scoped-lists", "some", "central", "perrow"]) {
  for (const idKind of ["sequential", "random"]) {
    const r = attack(auth, idKind, false);
    console.log(`${auth} + ${idKind} ids: read ${r.read}, changed ${r.change}, deleted ${r.del} of 15 | ${ENDPOINTS.map((e) => `${e.id} ${r.exposed[e.id]}`).join(" ")} | valid guesses ${r.guessedValid}`);
  }
}
console.log("one foreign id leaks (a shared link or a log line), random ids:");
for (const auth of ["none", "scoped-lists", "some", "central", "perrow"]) {
  const r = attack(auth, "random", true);
  console.log(`  ${auth}: read ${r.read}, changed ${r.change}, deleted ${r.del} of 15`);
}
console.log("cost of one list request by table size (own invoices are a quarter of the table):");
for (const n of [20, 1000, 100000]) {
  console.log(`  ${n} invoices: scoped query reads ${n / 4} rows and makes 1 policy call; fetch-all-then-check reads ${n} rows and makes ${n} policy calls`);
}
