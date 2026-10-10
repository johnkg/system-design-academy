// Lamport and vector clocks in JavaScript, on a small fixed scenario.
// Processes: A, B, C. A sends a message to B, and B sends one to C. C also does something on its own.

const procs = ["A", "B", "C"];
const lamport = { A: 0, B: 0, C: 0 };
const vector = { A: [0, 0, 0], B: [0, 0, 0], C: [0, 0, 0] };
const events = []; // { name, lamport, vector }

function record(name, p) {
  events.push({ name, lamport: lamport[p], vector: [...vector[p]] });
}

function local(name, p) {
  lamport[p] += 1;
  vector[p][procs.indexOf(p)] += 1;
  record(name, p);
}

function send(name, from) {
  local(name, from);
  return { lamport: lamport[from], vector: [...vector[from]] }; // the message carries the sender's clocks
}

function receive(name, to, message) {
  lamport[to] = Math.max(lamport[to], message.lamport) + 1; // jump past the sender's time
  vector[to] = vector[to].map((v, i) => Math.max(v, message.vector[i]));
  vector[to][procs.indexOf(to)] += 1;
  record(name, to);
}

local("A1 write x", "A");
const m1 = send("A2 send to B", "A");
receive("B1 receive from A", "B", m1);
const m2 = send("B2 send to C", "B");
local("C1 local event", "C"); // happens independently of A and B
receive("C2 receive from B", "C", m2);

for (const e of events) console.log(`${e.name.padEnd(20)} lamport ${e.lamport}  vector [${e.vector}]`);

// Vector comparison: before, after, equal or concurrent
function relation(a, b) {
  const lessOrEqual = a.every((v, i) => v <= b[i]);
  const greaterOrEqual = a.every((v, i) => v >= b[i]);
  if (lessOrEqual && greaterOrEqual) return "equal";
  if (lessOrEqual) return "happened before";
  if (greaterOrEqual) return "happened after";
  return "concurrent";
}

const byName = Object.fromEntries(events.map((e) => [e.name.slice(0, 2), e]));
for (const [x, y] of [["A1", "C2"], ["A2", "B1"], ["A1", "C1"]]) {
  console.log(`${x} vs ${y}: ${relation(byName[x].vector, byName[y].vector)}  (lamport ${byName[x].lamport} vs ${byName[y].lamport})`);
}
