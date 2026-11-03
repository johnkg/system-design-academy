// A miniature of the ideas in the 2007 Dynamo paper, in JavaScript (a teaching model, not Amazon's code): a key is hashed onto a
// ring, copied to the first N healthy nodes of its preference list (a sloppy quorum with a hinted stand-in), every update carries a
// vector clock, and a read that finds conflicting versions returns all of them for the application to merge.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.

const NODES = ['A', 'B', 'C', 'D', 'E', 'F'];
const N = 3; // replicas per key
const R = 2; // replies a read waits for
const W = 2; // acknowledgements a write waits for

// 32-bit FNV-1a: a stand-in for the MD5 hash Dynamo puts on a key.
function fnv(text) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

// The ring: each node sits at a position, and a key belongs to the first node clockwise from its own position.
const ring = NODES.map((node) => ({ node, at: fnv(`node-${node}`) })).sort((a, b) => a.at - b.at);
function preferenceList(key) {
  const start = Math.max(ring.findIndex((slot) => slot.at >= fnv(key)), 0);
  return Array.from({ length: ring.length }, (_, i) => ring[(start + i) % ring.length].node);
}

// A vector clock maps a node to a counter. a descends from b when every counter in b is at most the one in a.
const descends = (a, b) => Object.entries(b).every(([node, counter]) => (a[node] ?? 0) >= counter);
const show = (clock) => `{${Object.entries(clock).sort(([a], [b]) => (a < b ? -1 : 1)).map(([node, counter]) => `${node}:${counter}`).join(',')}}`;

const stores = Object.fromEntries(NODES.map((node) => [node, []])); // node -> versions of the cart: {value, clock}
const hints = []; // {holder, intended, version}

// A put goes to the first N healthy nodes of the preference list. A node that is down is replaced by the next healthy one,
// which keeps a hint so that it can hand the copy back.
function put(value, clock, coordinator, down, list) {
  const next = { ...clock, [coordinator]: (clock[coordinator] ?? 0) + 1 };
  const version = { value, clock: next };
  const wanted = list.slice(0, N);
  const chosen = list.filter((node) => !down.has(node)).slice(0, N);
  for (const node of chosen) {
    stores[node] = [...stores[node].filter((old) => !descends(next, old.clock)), version];
    if (!wanted.includes(node)) hints.push({ holder: node, intended: wanted.find((w) => down.has(w)), version });
  }
  const accepted = chosen.length >= W;
  console.log(`put ${value} clock ${show(next)} stored on ${chosen.join('')}${accepted ? ', accepted' : ', REFUSED'}`);
  return { clock: next, accepted };
}

// A get asks R nodes and keeps every version that no other version descends from.
function get(askNodes) {
  const found = new Map();
  for (const node of askNodes.slice(0, R)) for (const v of stores[node]) found.set(show(v.clock), v);
  const all = [...found.values()];
  return all.filter((v) => !all.some((o) => descends(o.clock, v.clock) && !descends(v.clock, o.clock)));
}

const list = preferenceList('cart-42');
const [first, second, third] = list;
console.log(`--- preference list for cart-42: ${list.slice(0, N).join('')} (then ${list.slice(N).join('')} as spares)`);
console.log(`--- ${third} is down: writes still succeed, and ${list[N]} keeps a hint`);
const down = new Set([third]);
const v1 = put('book', {}, first, new Set(), list);
const v2 = put('book,pen', v1.clock, first, down, list); // client 1 adds a pen, from the clock it read
const v3 = put('book,mug', v1.clock, second, down, list); // client 2 adds a mug from the same older clock: a conflict

console.log('--- read: two versions that neither descends from the other');
const seen = get([first, second]);
console.log(`versions returned: ${seen.map((v) => v.value).sort().join(' | ')}`);
const merged = [...new Set(seen.flatMap((v) => v.value.split(',')))].sort().join(',');
const context = {};
for (const v of seen) for (const [node, counter] of Object.entries(v.clock)) context[node] = Math.max(context[node] ?? 0, counter);
const v4 = put(merged, context, first, down, list);
console.log(`after the merge a read returns ${get([first, second]).map((v) => v.value).join(' | ')}`);

console.log('--- hinted handoff when the node returns');
for (const hint of hints) {
  stores[hint.intended] = [...stores[hint.intended].filter((old) => !descends(hint.version.clock, old.clock)), hint.version];
  console.log(`${hint.holder} hands ${hint.version.value} back to ${hint.intended}`);
}
const holders = list.slice(0, N).filter((node) => stores[node].length === 1 && stores[node][0].value === merged);
console.log(`nodes holding the merged cart: ${holders.join('')}`);
const ok = v2.accepted && v3.accepted && v4.accepted && seen.length === 2 && merged === 'book,mug,pen' && holders.length === N;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
