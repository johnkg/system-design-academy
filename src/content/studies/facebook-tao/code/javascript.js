// A miniature of the TAO data model and request path from Facebook's "TAO: The power of the graph" (2013), in JavaScript
// (a teaching model, not Facebook's code): typed objects and typed, timed associations, automatic inverse edges, point, range and
// count queries, and a follower cache in front of a leader cache in front of the database (MySQL's role), where a write travels
// through the leader and every cache on the way updates from the reply. Everything is deterministic.

const SHARDS = 4;
const INVERSE = { friend: 'friend', like: 'liked_by', liked_by: 'like' };
const shardOf = (id) => id % SHARDS; // every object and every association list of an id lives on one shard

const db = { objects: new Map(), lists: new Map(), reads: 0 }; // the persistent store
const leader = { objects: new Map(), lists: new Map() }; // regional cache that talks to the database
const follower = { objects: new Map(), lists: new Map() }; // cache that clients talk to
let served = ''; // which tier answered the last read
const listKey = (id1, type) => `${id1}:${type}`;

function tierRead(kind, key, fromDb) { // follower, then leader, then database; fill the caches on the way back
  if (follower[kind].has(key)) { served = 'follower'; return follower[kind].get(key); }
  if (leader[kind].has(key)) { served = 'leader'; follower[kind].set(key, leader[kind].get(key)); return follower[kind].get(key); }
  db.reads++; served = 'database';
  const value = fromDb();
  leader[kind].set(key, value); follower[kind].set(key, value);
  return value;
}

function objectCreate(id, type, fields) {
  const obj = { id, type, ...fields };
  db.objects.set(id, obj);
  leader.objects.set(id, obj); follower.objects.set(id, obj);
}
const objectGet = (id) => tierRead('objects', id, () => db.objects.get(id));
const range = (id1, type, limit) => tierRead('lists', listKey(id1, type), () => db.lists.get(listKey(id1, type)) ?? []).slice(0, limit);

function writeList(key, update) { // the write goes follower -> leader -> database; each tier updates from the reply
  const next = update(db.lists.get(key) ?? []);
  db.lists.set(key, next); leader.lists.set(key, next); follower.lists.set(key, next);
}
function assocAdd(id1, type, id2, time) {
  const add = (a, t, b) => writeList(listKey(a, t), (list) => [{ id2: b, time }, ...list.filter((e) => e.id2 !== b)].sort((x, y) => y.time - x.time));
  add(id1, type, id2);
  add(id2, INVERSE[type], id1); // the inverse edge is created automatically
}
function assocDelete(id1, type, id2) {
  const del = (a, t, b) => writeList(listKey(a, t), (list) => list.filter((e) => e.id2 !== b));
  del(id1, type, id2);
  del(id2, INVERSE[type], id1);
}
const count = (id1, type) => range(id1, type, Infinity).length; // TAO keeps a count so this is constant time; here it is the list length
const point = (id1, type, id2) => range(id1, type, Infinity).some((e) => e.id2 === id2);
const names = (list) => list.map((e) => `${objectGet(e.id2).name}@${e.time}`).join(', ') || 'none';

objectCreate(1, 'user', { name: 'Alice' });
objectCreate(2, 'user', { name: 'Bob' });
objectCreate(3, 'user', { name: 'Carol' });
objectCreate(4, 'photo', { name: 'beach.jpg' });
console.log(`shards: ${[1, 2, 3, 4].map((id) => `${objectGet(id).name} -> shard ${shardOf(id)}`).join(', ')}`);

assocAdd(1, 'friend', 2, 10);
assocAdd(1, 'friend', 3, 20);
assocAdd(3, 'like', 4, 30);
// Start with cold caches, as after a restart, to show where the reads come from.
for (const tier of [leader, follower]) tier.lists.clear();

function show(label, id1, type) {
  const list = range(id1, type, 10);
  const by = served; // names() reads objects and would change `served`
  console.log(`${label}: ${names(list)} (served by the ${by})`);
}
show("Alice's friends, newest first", 1, 'friend');
show("Alice's friends again", 1, 'friend');
follower.lists.clear(); // a different follower that has not seen this list yet
show("Alice's friends, empty follower cache", 1, 'friend');
console.log(`Alice has ${count(1, 'friend')} friends`);
console.log(`is Bob a friend of Alice? ${point(1, 'friend', 2)}; is Alice a friend of Bob (the inverse edge)? ${point(2, 'friend', 1)}`);
show('who liked beach.jpg', 4, 'liked_by');

objectCreate(5, 'user', { name: 'Dave' });
assocAdd(1, 'friend', 5, 40);
show("after a write, Alice's friends", 1, 'friend');
assocDelete(1, 'friend', 2);
console.log(`after unfriending Bob: Alice has ${count(1, 'friend')} friends, Bob has ${count(2, 'friend')}`);
console.log(`database reads in total: ${db.reads}`);
