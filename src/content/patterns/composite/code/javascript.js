// Composite in JavaScript. Files and folders share getSize() and print().

class File { // Leaf
  constructor(name, size) { this.name = name; this.size = size; }
  getSize() { return this.size; }
  print(indent = "") { console.log(`${indent}${this.name} (${this.size})`); }
}

class Folder { // Composite
  #children = [];
  constructor(name) { this.name = name; }

  add(item) { this.#children.push(item); return this; }
  getSize() { return this.#children.reduce((sum, c) => sum + c.getSize(), 0); } // recurses
  print(indent = "") {
    console.log(`${indent}${this.name}/ (${this.getSize()})`);
    this.#children.forEach((c) => c.print(indent + "  "));
  }
}

const project = new Folder("project")
  .add(new File("readme.md", 10))
  .add(new Folder("src")
    .add(new File("app.js", 40))
    .add(new File("util.js", 15)));

project.print();
console.log(project.getSize()); // 65: the client never checks file vs folder
