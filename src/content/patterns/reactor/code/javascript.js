// Reactor in JavaScript. One loop asks which connections are ready and dispatches each to its handler.
// The demultiplexer is simulated with fixed batches so that the output is the same on every run;
// real servers use select, epoll or kqueue (Node.js does this inside libuv).

class Selector { // Event demultiplexer: reports which sources are ready
  constructor(batches) { this.batches = [...batches]; }
  select() { return this.batches.shift() ?? null; }
}

class Reactor {
  #handlers = new Map();
  constructor(selector) { this.selector = selector; }

  register(connection, handler) { this.#handlers.set(connection, handler); }
  get size() { return this.#handlers.size; }

  run() {
    let batchNumber = 0;
    for (let ready = this.selector.select(); ready !== null; ready = this.selector.select()) {
      batchNumber += 1;
      console.log(`batch ${batchNumber}: ${ready.length} ready`);
      for (const { connection, data } of ready) { // dispatch: each handler is quick and does not block
        const reply = this.#handlers.get(connection)(data);
        console.log(`  ${connection} got "${data}" -> "${reply}"`);
      }
    }
    console.log("reactor: no more events, loop ends");
  }
}

const shout = (data) => data.toUpperCase(); // Event handlers
const greeter = (data) => (data === "bye" ? "goodbye" : "hello");

const selector = new Selector([
  [{ connection: "conn-2", data: "hello" }, { connection: "conn-1", data: "ping" }],
  [{ connection: "conn-3", data: "bye" }],
]);
const reactor = new Reactor(selector);
reactor.register("conn-1", shout);
reactor.register("conn-2", shout);
reactor.register("conn-3", greeter);
console.log(`reactor: ${reactor.size} connections registered`);
reactor.run();
