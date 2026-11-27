// Active Object in JavaScript. Calls become queued requests, run one at a time by a single loop.
// (A Web Worker would give the servant its own thread; here the async queue shows the same structure.)

class Calculator { // Servant: a plain class, only ever called by the scheduler
  #history = [];
  add(a, b) { const result = a + b; this.#history.push(result); return result; }
  history() { return this.#history.join(", "); }
}

class ActiveCalculator { // Proxy and scheduler: callers get a promise (the future) straight away
  #servant; #queue = []; #running = false;
  ran = 0;
  constructor(servant) { this.#servant = servant; }

  add(a, b) { return this.#enqueue(() => this.#servant.add(a, b)); }
  history() { return this.#enqueue(() => this.#servant.history()); }

  #enqueue(call) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ call, resolve, reject });
      this.#drain();
    });
  }

  async #drain() { // one request at a time, in the order they were submitted
    if (this.#running) return;
    this.#running = true;
    while (this.#queue.length > 0) {
      const { call, resolve, reject } = this.#queue.shift();
      await Promise.resolve();
      try { resolve(call()); } catch (error) { reject(error); }
      this.ran += 1;
    }
    this.#running = false;
  }
}

(async () => {
  const calculator = new ActiveCalculator(new Calculator());

  const first = calculator.add(2, 3);
  console.log("submitted add(2, 3)");
  const second = calculator.add(10, 5);
  console.log("submitted add(10, 5)");
  const history = calculator.history();
  console.log("submitted history()");

  console.log(`add(2, 3) = ${await first}`);
  console.log(`add(10, 5) = ${await second}`);
  console.log(`history() = ${await history}`);
  console.log(`Servant ran ${calculator.ran} requests on one worker`);
})();
