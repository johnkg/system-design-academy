// Without the pattern: every tree carries its own copy of the species data.

class Tree {
  constructor(x, y, name, color, texture) {
    Object.assign(this, { x, y, name, color, texture }); // texture duplicated per tree
  }
}

const TREES = 1000, TEXTURE_CHARS = 10_000;
const trees = [];
for (let i = 0; i < TREES; i++) {
  const oak = i % 2;
  trees.push(new Tree(i, i * 2, oak ? "Oak" : "Pine", oak ? "green" : "dark green", "x".repeat(TEXTURE_CHARS)));
}

console.log(`${trees.length} trees, each with its own 10,000-character texture field`);
// Memory scales with the number of trees, not the number of species.
