// Without the pattern: callers run the method themselves, and each one waits for it to finish.

class Calculator {
  #history = [];
  add(a, b) { const result = a + b; this.#history.push(result); return result; }
  history() { return this.#history.join(", "); }
}

const calculator = new Calculator();
// With real threads, every caller would need a lock around the shared history, and would wait for its turn.
console.log(`add(2, 3) = ${calculator.add(2, 3)}`);
console.log(`add(10, 5) = ${calculator.add(10, 5)}`);
console.log(`history() = ${calculator.history()}`);
