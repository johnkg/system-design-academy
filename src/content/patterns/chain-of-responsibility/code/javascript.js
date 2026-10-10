// Chain of Responsibility in JavaScript. Each approver handles or passes on.

class Approver { // Handler
  #next = null;
  constructor(name, limit) { this.name = name; this.limit = limit; }

  setNext(next) { this.#next = next; return next; } // returns next so calls chain

  approve(amount) {
    if (amount <= this.limit) return `${this.name} approves $${amount}`;
    if (this.#next) return this.#next.approve(amount); // pass it on
    return `No one can approve $${amount}`;
  }
}

const manager = new Approver("Manager", 1_000);   // Concrete Handlers
const director = new Approver("Director", 10_000);
const ceo = new Approver("CEO", Infinity);
manager.setNext(director).setNext(ceo);

console.log(manager.approve(500));     // Manager approves $500
console.log(manager.approve(5_000));   // Director approves $5000
console.log(manager.approve(50_000));  // CEO approves $50000
