// Unit of Work in JavaScript. Changes are remembered, then saved together or not at all.

class Store { // Data store: rejects a bad value, and can restore an earlier state
  data = new Map();
  write(key, value) {
    if (key.startsWith("points:") && !/^\d+$/.test(value)) throw new Error("points must be a number");
    this.data.set(key, value);
  }
  snapshot() { return new Map(this.data); }
  restore(snapshot) { this.data = snapshot; }
  show() {
    return [...this.data].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(", ");
  }
}

class UnitOfWork {
  #changes = new Map();
  constructor(store) { this.store = store; }

  set(key, value) { this.#changes.set(key, value); } // remembered, not written yet

  commit() {
    const before = this.store.snapshot();
    const count = this.#changes.size;
    try {
      for (const [key, value] of this.#changes) this.store.write(key, value);
      console.log(`Committed ${count} changes`);
    } catch (error) {
      this.store.restore(before);
      console.log(`Rolled back after a failed write: ${error.message}`);
    } finally {
      this.#changes.clear();
    }
  }
}

const store = new Store();

const first = new UnitOfWork(store);
first.set("order:1", "paid");
first.set("stock:apple", "9");
first.set("points:ada", "15");
first.commit();
console.log(`Store: ${store.show()}`);

const second = new UnitOfWork(store);
second.set("order:2", "paid");
second.set("stock:apple", "8");
second.set("points:ada", "lots"); // the store rejects this one
second.commit();
console.log(`Store: ${store.show()}`);
