// Prototype in JavaScript. clone() makes a deep-enough copy so clones stay independent.

class Enemy { // Concrete Prototype
  constructor(name, hp, items = []) {
    this.name = name;
    this.hp = hp;
    this.items = items;
  }

  clone() {
    return new Enemy(this.name, this.hp, [...this.items]); // copy the list, do not share it
  }
}

class Spawner { // Client with a registry of prototypes
  #registry = new Map();
  register(key, prototype) { this.#registry.set(key, prototype); }
  spawn(key) { return this.#registry.get(key).clone(); }
}

const spawner = new Spawner();
spawner.register("goblin", new Enemy("Goblin", 30, ["club"]));

const a = spawner.spawn("goblin");
const b = spawner.spawn("goblin");
a.items.push("shield");

console.log(a.items); // [ 'club', 'shield' ]
console.log(b.items); // [ 'club' ]: unaffected, thanks to the deep copy
