// Composition over inheritance. Part 1 is the fragile base class: a subclass that counts the units added to an army works
// until the base class changes how addAll is implemented, while a wrapper that holds an army does not care. Part 2 composes a
// unit from parts and counts, for a game whose units may combine any movement abilities with one attack style, how many
// classes each design needs. Look for: the count changing with no edit to the subclass, and the class counts as abilities grow.
class ArmyV1 { constructor() { this.units = []; } add(u) { this.units.push(u); } addAll(us) { for (const u of us) this.add(u); } }
class ArmyV2 { constructor() { this.units = []; } add(u) { this.units.push(u); } addAll(us) { this.units.push(...us); } } // "faster": no longer calls add
const counting = (Base) => class extends Base { // inheritance: counts by overriding both entry points
  constructor() { super(); this.count = 0; }
  add(u) { this.count++; super.add(u); }
  addAll(us) { this.count += us.length; super.addAll(us); }
};
class CountingArmy { // composition: holds an army, forwards to it, counts what it forwards
  constructor(inner) { this.inner = inner; this.count = 0; }
  add(u) { this.count++; this.inner.add(u); }
  addAll(us) { this.count += us.length; this.inner.addAll(us); }
}
for (const [label, Base] of [['base v1 (addAll calls add)', ArmyV1], ['base v2 (addAll no longer calls add)', ArmyV2]]) {
  const sub = new (counting(Base))(); sub.addAll(['archer', 'knight']);
  const wrapped = new CountingArmy(new Base()); wrapped.addAll(['archer', 'knight']);
  console.log(`${label}: inheritance added ${sub.units.length}, counted ${sub.count}; composition added ${wrapped.inner.units.length}, counted ${wrapped.count}`);
}

// A unit composed from parts: a list of movement behaviours and one attack behaviour.
const walk = { name: 'walk', speed: 2 }, swim = { name: 'swim', speed: 3 }, fly = { name: 'fly', speed: 5 };
const melee = { name: 'melee', damage: 6 }, ranged = { name: 'ranged', damage: 4 };
class Unit { constructor(name, moves, attack) { this.name = name; this.moves = moves; this.attack = attack; } describe() { return `${this.name}: ${this.moves.map((m) => `${m.name} ${m.speed}`).join(', ')}; ${this.attack.name} ${this.attack.damage}`; } }
console.log(new Unit('duck', [walk, swim, fly], ranged).describe());
console.log(new Unit('frog', [walk, swim], melee).describe());

// Part 2: M movement abilities, A attack styles, and a game that needs every combination (any non-empty set of movements, one attack).
// Single inheritance: a class gets one parent, which can supply only one behaviour; the others are written again in the class.
const types = (m, a) => (2 ** m - 1) * a;
const DESIGNS = {
  'deep inheritance': (m, a) => ({ classes: 1 + types(m, a), duplicated: a * m * 2 ** (m - 1), affected: 1 + types(m, a), addAbility: 2 ** m * a }),
  'composition': (m, a) => ({ classes: 3 + m + a, duplicated: 0, affected: 1, addAbility: 1 }),                 // Unit, 2 interfaces, one class per behaviour
  'shallow inheritance plus composition': (m, a) => ({ classes: 5 + m + a, duplicated: 0, affected: 3, addAbility: 1 }), // plus 2 real subclasses of Unit
};
for (const [m, a] of [[2, 2], [3, 2], [4, 2], [6, 2], [6, 4]]) {
  console.log(`-- ${m} movement abilities, ${a} attack styles: ${types(m, a)} unit types`);
  for (const [name, f] of Object.entries(DESIGNS)) {
    const r = f(m, a);
    console.log(`  ${name}: ${r.classes} classes, ${r.duplicated} copies of ability code, ${r.affected} classes hit by a base change, ${r.addAbility} classes to add one ability`);
  }
}
