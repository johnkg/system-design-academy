// A shopping cart that merges without losing items, in JavaScript:
// an add-wins observed-remove set for the items and a PN-counter for the quantities, compared with two simpler merge rules.

class Replica {
  constructor(id, from) {
    this.id = id;
    this.n = from ? from.n : 0;                                   // counter used to make unique add tags
    this.tags = new Map(from ? from.tags : []);                   // tag -> item, one tag per add operation
    this.amount = new Map(from ? from.amount : []);               // tag -> quantity added by that operation
    this.dead = new Set(from ? from.dead : []);                   // tags that a remove has seen (tombstones)
    this.dec = new Map(from ? from.dec : []);                     // "tag|replica" -> units taken away (a PN-counter's negative half)
  }
  add(item, q = 1) { const t = `${this.id}#${this.n++}`; this.tags.set(t, item); this.amount.set(t, q); }
  left(t) { let d = 0; for (const [k, v] of this.dec) if (k.split('|')[0] === t) d += v; return this.amount.get(t) - d; }
  live(item) { return [...this.tags].filter(([t, i]) => i === item && !this.dead.has(t)).map(([t]) => t); }
  qty(item) { return this.live(item).reduce((s, t) => s + this.left(t), 0); }
  // More of an item is a new add (so a concurrent remove cannot cancel it); fewer takes units off a tag this replica can see.
  adjust(item, d) {
    if (d > 0) return this.add(item, d);
    const k = `${this.live(item).find((t) => this.left(t) > 0)}|${this.id}`;
    this.dec.set(k, (this.dec.get(k) || 0) - d);
  }
  // A remove only covers the add tags this replica has seen.
  remove(item) { this.live(item).forEach((t) => this.dead.add(t)); }
  // Union of tags and tombstones, and the larger value for every counter: order and repeats do not matter.
  merge(o) {
    const r = new Replica('M', this);
    o.tags.forEach((v, k) => r.tags.set(k, v));
    o.amount.forEach((v, k) => r.amount.set(k, v));
    o.dead.forEach((t) => r.dead.add(t));
    o.dec.forEach((v, k) => r.dec.set(k, Math.max(r.dec.get(k) || 0, v)));
    return r;
  }
  view() {
    const items = [...new Set(this.tags.values())].sort();
    return Object.fromEntries(items.map((i) => [i, this.qty(i)]).filter(([, q]) => q > 0));
  }
  size() { return this.tags.size + this.amount.size + this.dead.size + this.dec.size; }
}

const show = (c) => Object.entries(c).map(([i, q]) => `${i}:${q}`).join(' ');
const list = (a) => (a.length ? a.join(',') : '-');
function compare(got, want) {
  const lost = Object.keys(want).filter((i) => !(i in got));
  const back = Object.keys(got).filter((i) => !(i in want));
  const wrong = Object.keys(got).filter((i) => i in want && got[i] !== want[i]);
  return { text: `lost=${list(lost)} back=${list(back)} wrong=${list(wrong)}`, ok: lost.length + back.length + wrong.length === 0 };
}

// The shared cart, then a partition: a phone and a laptop each change their own copy.
const phone = new Replica('A');
phone.add('book', 2); phone.add('pen'); phone.add('lamp');
const laptop = new Replica('B', phone);
phone.remove('pen'); phone.add('mug'); phone.adjust('book', 2);      // phone: drop pen, add mug, book 2 -> 4
laptop.remove('lamp'); laptop.add('pen'); laptop.adjust('book', -1); // laptop: drop lamp, one more pen (unseen by the phone's remove), book 2 -> 1
const intended = { book: 3, mug: 1, pen: 1 };                          // the phone's remove only covered the pen it had seen, so the new pen stays

const a = phone.view(), b = laptop.view();
const lww = b;                                                        // the laptop's clock was later, so its whole cart wins
const union = {};
for (const c of [a, b]) for (const [i, q] of Object.entries(c)) union[i] = Math.max(union[i] || 0, q);
const merged = phone.merge(laptop);

console.log(`intended: ${show(intended)}`);
for (const [name, cart] of [['last write wins', lww], ['union of items', union], ['add-wins set + counters', merged.view()]]) {
  console.log(`${name.padEnd(24)} ${show(cart).padEnd(26)} ${compare(cart, intended).text}`);
}
const flip = laptop.merge(phone), again = merged.merge(laptop);
const orderFree = show(flip.view()) === show(merged.view()) && show(again.view()) === show(merged.view());
console.log(`merge order and repeats do not matter: ${orderFree}; metadata entries: ${merged.size()}`);
if (!compare(merged.view(), intended).ok || compare(lww, intended).ok || compare(union, intended).ok || !orderFree) process.exit(1);
