// Liskov Substitution Principle: a client written against a base type's contract, run against substitutes.
// Look for: which checks each subtype fails, and why. Every subtype is accepted by the language; only behaviour tells them apart.
// Bag contract: add(x) accepts any integer; after add(x), contains(x) is true and size() grew by 1;
// remove(x) takes one x out; size() always equals adds minus removes.

class Bag { // the base type and its contract
  add(x) { throw new Error('abstract'); }
  remove(x) { throw new Error('abstract'); }
  contains(x) { throw new Error('abstract'); }
  size() { throw new Error('abstract'); }
}
class ListBag extends Bag { // honest: keeps every item, duplicates included
  constructor(items) { super(); this.items = items.slice(); }
  add(x) { this.items.push(x); }
  remove(x) { const i = this.items.indexOf(x); if (i >= 0) this.items.splice(i, 1); }
  contains(x) { return this.items.includes(x); }
  size() { return this.items.length; }
}
class DedupBag extends ListBag { // reused ListBag, but add ignores a value it already holds: postcondition weakened
  add(x) { if (!this.items.includes(x)) super.add(x); }
}
class PositiveBag extends ListBag { // reused ListBag, but add rejects what the base accepts: precondition strengthened
  add(x) { if (x <= 0) throw new Error('only positive numbers'); super.add(x); }
}
class ReadOnlyBag extends ListBag { // reused ListBag to get the reads, then switched off the writes
  add(x) { throw new Error('read-only: add is not allowed'); }
}
class ReadOnlyView { // composition: holds a list, offers only reading, and does not claim to be a Bag
  constructor(items) { this.items = items.slice(); }
  contains(x) { return this.items.includes(x); }
  size() { return this.items.length; }
}

// The client: each check gets a fresh bag and returns null when it holds, or why it failed.
const attempt = (fn) => { try { return fn(); } catch (e) { return `threw '${e.message}'`; } };
const expect = (got, want) => (got === want ? null : `got ${got}, expected ${want}`);
const WRITER_CHECKS = [
  ['C1 add accepts any integer, even -1', (b) => { b.add(-1); return null; }],
  ['C2 after add(5), contains(5)', (b) => { b.add(5); return expect(b.contains(5), true); }],
  ['C3 two adds of 5 make size 2', (b) => { b.add(5); b.add(5); return expect(b.size(), 2); }],
  ['C4 add(5) then remove(5) leaves it empty', (b) => { b.add(5); b.remove(5); return expect(`${b.size()} ${b.contains(5)}`, '0 false'); }],
  ['C5 size is adds minus removes (3 adds, 1 remove)', (b) => { b.add(1); b.add(1); b.add(2); b.remove(1); return expect(b.size(), 2); }],
];
const READER_CHECKS = [
  ['R1 contains what it was built with', (r) => expect(`${r.contains(3)} ${r.contains(9)}`, 'true false')],
  ['R2 size is the number of items', (r) => expect(r.size(), 2)],
];

function runClient(title, checks, make, mustBe, mustName) {
  console.log(`-- ${title}`);
  if (mustBe && !(make() instanceof mustBe)) { console.log(`   rejected: not a ${mustName}, so this client cannot be given one`); return; }
  let pass = 0;
  for (const [label, check] of checks) {
    const why = attempt(() => check(make()));
    if (why === null) pass++;
    console.log(`   ${label}: ${why === null ? 'pass' : `FAIL, ${why}`}`);
  }
  console.log(`   ${pass}/${checks.length} checks pass`);
}

console.log('== Bag contract, writer client');
runClient('ListBag (honest)', WRITER_CHECKS, () => new ListBag([]), Bag, 'Bag');
runClient('DedupBag (add ignores duplicates)', WRITER_CHECKS, () => new DedupBag([]), Bag, 'Bag');
runClient('PositiveBag (add rejects numbers up to 0)', WRITER_CHECKS, () => new PositiveBag([]), Bag, 'Bag');
runClient('ReadOnlyBag (inherited, add throws)', WRITER_CHECKS, () => new ReadOnlyBag([]), Bag, 'Bag');
runClient('ReadOnlyView (composition)', WRITER_CHECKS, () => new ReadOnlyView([]), Bag, 'Bag');
console.log('== Bag contract, reader client');
runClient('ReadOnlyBag (inherited)', READER_CHECKS, () => new ReadOnlyBag([3, 4]), null);
runClient('ReadOnlyView (composition)', READER_CHECKS, () => new ReadOnlyView([3, 4]), null);

// Rectangle contract: setWidth and setHeight change only their own side; area is width times height.
class Rectangle {
  constructor(w, h) { this.w = w; this.h = h; }
  setWidth(w) { this.w = w; }
  setHeight(h) { this.h = h; }
  width() { return this.w; }
  area() { return this.w * this.h; }
}
class InheritedSquare extends Rectangle { // a square "is a" rectangle, so it inherits and keeps its sides equal
  constructor(s) { super(s, s); }
  setWidth(w) { this.w = w; this.h = w; }
  setHeight(h) { this.w = h; this.h = h; }
}
class SquareShape { // composition: a square with a side and an area, not claiming to be a Rectangle
  constructor(s) { this.s = s; }
  area() { return this.s * this.s; }
}
const RECT_CHECKS = [
  ['Q1 setWidth(5), setHeight(4): area is 20', (r) => { r.setWidth(5); r.setHeight(4); return expect(r.area(), 20); }],
  ['Q2 setHeight(4) leaves the width at 5', (r) => { r.setWidth(5); r.setHeight(4); return expect(r.width(), 5); }],
  ['Q3 setWidth(3) reads back as 3', (r) => { r.setWidth(3); return expect(r.width(), 3); }],
];
const SHAPE_CHECKS = [['S1 a shape with sides of 3 has area 9', (s) => expect(s.area(), 9)]];
console.log('== Rectangle contract, client of Rectangle');
runClient('Rectangle (honest)', RECT_CHECKS, () => new Rectangle(1, 1), Rectangle, 'Rectangle');
runClient('InheritedSquare (setters change both sides)', RECT_CHECKS, () => new InheritedSquare(1), Rectangle, 'Rectangle');
runClient('SquareShape (composition)', RECT_CHECKS, () => new SquareShape(1), Rectangle, 'Rectangle');
console.log('== Shape contract, client that only asks for the area');
runClient('Rectangle', SHAPE_CHECKS, () => new Rectangle(3, 3), null);
runClient('InheritedSquare', SHAPE_CHECKS, () => new InheritedSquare(3), null);
runClient('SquareShape (composition)', SHAPE_CHECKS, () => new SquareShape(3), null);
