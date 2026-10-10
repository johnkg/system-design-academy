// Command in JavaScript. Actions become objects with execute() and undo().

class Document { // Receiver
  text = "";
}

class InsertCommand { // Concrete Command
  constructor(doc, text) { this.doc = doc; this.text = text; }
  execute() { this.doc.text += this.text; }
  undo() { this.doc.text = this.doc.text.slice(0, -this.text.length); }
}

class UppercaseCommand { // Concrete Command
  constructor(doc) { this.doc = doc; this.before = ""; }
  execute() { this.before = this.doc.text; this.doc.text = this.doc.text.toUpperCase(); }
  undo() { this.doc.text = this.before; } // remember state so we can restore it
}

class History { // Invoker
  #done = [];
  #undone = [];

  run(command) {
    command.execute();
    this.#done.push(command);
    this.#undone = []; // a new action clears the redo stack
  }
  undo() { const c = this.#done.pop(); if (c) { c.undo(); this.#undone.push(c); } }
  redo() { const c = this.#undone.pop(); if (c) { c.execute(); this.#done.push(c); } }
}

const doc = new Document();
const history = new History();

history.run(new InsertCommand(doc, "Hello"));
history.run(new InsertCommand(doc, " world"));
history.run(new UppercaseCommand(doc));
console.log(doc.text); // HELLO WORLD
history.undo();
console.log(doc.text); // Hello world
history.undo();
console.log(doc.text); // Hello
history.redo();
console.log(doc.text); // Hello world
