// Event sourcing in JavaScript: state is derived from an append-only list of events.

class Account {
  #events = [];
  balance = 0;

  static rebuild(events, from = { balance: 0, version: 0 }) { // replay events on top of a snapshot
    const account = new Account();
    account.balance = from.balance;
    account.#events = events.slice(0, from.version);
    for (const event of events.slice(from.version)) account.#record(event);
    return account;
  }

  deposit(amount) { this.#record({ type: "Deposited", amount }); }

  withdraw(amount) { // a command is validated against current state before an event is recorded
    if (amount > this.balance) throw new Error("insufficient funds");
    this.#record({ type: "Withdrawn", amount });
  }

  get events() { return [...this.#events]; } // callers cannot modify history

  #record(event) { this.#events.push(event); this.#apply(event); }
  #apply(event) { this.balance += event.type === "Deposited" ? event.amount : -event.amount; }
}

const account = new Account();
account.deposit(100);
account.withdraw(30);
account.deposit(50);
console.log("balance:", account.balance);
console.log("events:", account.events.map((e) => `${e.type} ${e.amount}`).join(", "));

try { account.withdraw(500); } catch (error) { console.log("rejected:", error.message); } // no event is recorded

console.log("rebuilt from events:", Account.rebuild(account.events).balance);
console.log("balance after 2 events:", Account.rebuild(account.events.slice(0, 2)).balance); // time travel

const snapshot = { balance: 70, version: 2 }; // state saved at event 2
console.log(`from snapshot (balance 70 at event 2) + 1 later event: ${Account.rebuild(account.events, snapshot).balance}`);
