// Flyweight in JavaScript. Trees share one TreeType per species.
const TEXTURE_SIZE = 10_000; // characters in one species' texture
const TREES = 1000;

class TreeType { // Flyweight: intrinsic, immutable, shared
  constructor(name, color, texture) {
    Object.assign(this, { name, color, texture });
    Object.freeze(this);
  }
  draw(x, y) { return `${this.name} (${this.color}) at ${x},${y}`; }
}

class TreeTypeFactory { // Flyweight Factory
  static #cache = new Map();
  static get(name, color, texture) {
    const key = `${name}|${color}`;
    if (!TreeTypeFactory.#cache.has(key)) {
      TreeTypeFactory.#cache.set(key, new TreeType(name, color, texture));
    }
    return TreeTypeFactory.#cache.get(key);
  }
  static get count() { return TreeTypeFactory.#cache.size; }
}

class Tree { // Context: extrinsic state (x, y) + a reference to the shared type
  constructor(x, y, type) { this.x = x; this.y = y; this.type = type; }
  draw() { return this.type.draw(this.x, this.y); }
}

class Forest { // Client
  #trees = [];
  plant(x, y, name, color) {
    const type = TreeTypeFactory.get(name, color, "x".repeat(TEXTURE_SIZE)); // big texture, created once per species
    this.#trees.push(new Tree(x, y, type));
  }
  get size() { return this.#trees.length; }
}

const forest = new Forest();
for (let i = 0; i < TREES; i++) {
  forest.plant(i, i * 2, i % 2 ? "Oak" : "Pine", i % 2 ? "green" : "dark green");
}
console.log(`${forest.size} trees, ${TreeTypeFactory.count} shared TreeType objects`);
