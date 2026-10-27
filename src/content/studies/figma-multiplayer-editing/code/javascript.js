// A tiny model of the technique behind a server-authoritative editor, in JavaScript. It is a teaching sketch, not Figma's code.
// 1. A document is a map of (object, property) to value. The server decides the order of changes, and the last change
//    to a property in that order wins. Different properties never conflict.
// 2. A client shows its own edit at once. While that edit is unacknowledged it ignores incoming changes to that property.
// 3. A child's parent and its position among its siblings are one property, and the server refuses a parent that makes a cycle.
// There is no randomness or clock, so every run prints the same thing.

const server = new Map(); // "object.property" -> value, in the order the server accepted changes
const clients = ['A', 'B'].map((name) => ({ name, view: new Map(), pending: new Map() }));
const [A, B] = clients;

function edit(client, key, value) {
  client.view.set(key, value); // the screen changes immediately
  client.pending.set(key, (client.pending.get(key) ?? 0) + 1);
  console.log(`${client.name} edits ${key} = ${value}`);
  return { from: client, key, value };
}

function receive(client, change) {
  if (change.from === client) client.pending.set(change.key, client.pending.get(change.key) - 1); // an acknowledgement
  if ((client.pending.get(change.key) ?? 0) > 0) {
    console.log(`  ${client.name} skips ${change.key} = ${change.value}: it has its own unacknowledged edit there`);
    return;
  }
  client.view.set(change.key, change.value);
}

// The server takes the changes in the order they reached it and tells everyone.
function serve(changes) {
  changes.forEach((change, i) => {
    server.set(change.key, change.value);
    console.log(`server #${i + 1}: ${change.from.name} sets ${change.key} = ${change.value}`);
    clients.forEach((client) => receive(client, change));
  });
}

console.log('-- properties');
const red = edit(A, 'box.fill', 'red');
const green = edit(A, 'box.fill', 'green');
const blue = edit(B, 'box.fill', 'blue');
const move = edit(A, 'box.x', 10);
const fade = edit(B, 'box.opacity', 0.5);
serve([red, blue, move, green, fade]); // B's blue reached the server between A's two fills
for (const c of clients) console.log(`${c.name} sees fill=${c.view.get('box.fill')} x=${c.view.get('box.x')} opacity=${c.view.get('box.opacity')}`);
console.log(`server has fill=${server.get('box.fill')} x=${server.get('box.x')} opacity=${server.get('box.opacity')}`);

console.log('-- tree');
const tree = new Map([['frame', { parent: 'page', pos: 0.25 }], ['box', { parent: 'page', pos: 0.75 }]]); // the page's children
const children = (parent) => [...tree].filter(([, v]) => v.parent === parent).sort((p, q) => p[1].pos - q[1].pos || (p[0] < q[0] ? -1 : 1)).map(([id]) => id);
const between = (low, high) => (low + high) / 2; // a new position between two neighbours

function setParent(id, parent, pos) {
  for (let up = parent; up !== 'page'; up = tree.get(up).parent) {
    if (up === id) return console.log(`server refuses ${id} under ${parent}: that would make a cycle`);
  }
  tree.set(id, { parent, pos }); // parent and position change together, as one property
  console.log(`${id} under ${parent} at ${pos.toFixed(3)}`);
}

setParent('label', 'page', between(0.25, 0.75));
console.log(`page children: ${children('page').join(', ')}`);
setParent('box', 'page', tree.get('frame').pos / 2);
console.log(`page children: ${children('page').join(', ')}`);
setParent('frame', 'box', 0.5); // one client puts frame inside box
setParent('box', 'frame', 0.5); // at the same time another puts box inside frame
console.log(`box children: ${children('box').join(', ')}; frame children: ${children('frame').join(', ') || 'none'}`);
