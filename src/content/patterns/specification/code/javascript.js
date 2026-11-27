// Specification in JavaScript. A rule is an object that can be combined with and, or and not.

class Spec {
  and(other) { return new And(this, other); }
  or(other) { return new Or(this, other); }
  not() { return new Not(this); }
}

class Leaf extends Spec { // Leaf specification: one simple condition
  constructor(text, test) { super(); this.text = text; this.test = test; }
  isSatisfiedBy(customer) { return this.test(customer); }
  describe() { return this.text; }
}
class And extends Spec { // Composite specification
  constructor(left, right) { super(); this.left = left; this.right = right; }
  isSatisfiedBy(c) { return this.left.isSatisfiedBy(c) && this.right.isSatisfiedBy(c); }
  describe() { return `(${this.left.describe()} AND ${this.right.describe()})`; }
}
class Or extends Spec {
  constructor(left, right) { super(); this.left = left; this.right = right; }
  isSatisfiedBy(c) { return this.left.isSatisfiedBy(c) || this.right.isSatisfiedBy(c); }
  describe() { return `(${this.left.describe()} OR ${this.right.describe()})`; }
}
class Not extends Spec {
  constructor(inner) { super(); this.inner = inner; }
  isSatisfiedBy(c) { return !this.inner.isSatisfiedBy(c); }
  describe() { return `NOT ${this.inner.describe()}`; }
}

const active = new Leaf("active", (c) => c.active);
const blocked = new Leaf("blocked", (c) => c.blocked);
const totalAtLeast = (n) => new Leaf(`total >= ${n}`, (c) => c.total >= n);

const customers = [
  { name: "ada", active: true, blocked: false, total: 120 },
  { name: "bob", active: true, blocked: true, total: 200 },
  { name: "cy", active: false, blocked: false, total: 150 },
  { name: "dee", active: true, blocked: false, total: 60 },
];

function report(title, rule) {
  const yes = customers.filter((c) => rule.isSatisfiedBy(c)).map((c) => c.name);
  const no = customers.filter((c) => !rule.isSatisfiedBy(c)).map((c) => c.name);
  console.log(`${title}: ${rule.describe()}`);
  console.log(`  Eligible: ${yes.join(", ")}`);
  console.log(`  Not eligible: ${no.join(", ")}`);
}

report("Discount rule", active.and(blocked.not()).and(totalAtLeast(100)));
report("Login rule", active.and(blocked.not()));
