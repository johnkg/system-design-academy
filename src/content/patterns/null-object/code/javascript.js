// Null Object in JavaScript. A missing logger is a logger that does nothing.

class ConsoleLogger { // Real object
  log(message) { console.log(`[log] ${message}`); }
}

class NullLogger { // Null object: same interface, no behaviour
  log() {}
}

class OrderService { // Client: never checks whether the logger is real
  constructor(logger) { this.logger = logger; this.placed = 0; }
  place(id) {
    this.placed += 1;
    this.logger.log(`placed order ${id}`);
  }
}

function loggerFor(config) { // the one place that decides what a missing logger means
  return config.logging ? new ConsoleLogger() : new NullLogger();
}

console.log("With a logger:");
const withLogger = new OrderService(loggerFor({ logging: true }));
withLogger.place(1);
withLogger.place(2);
console.log(`Placed ${withLogger.placed} orders`);

console.log("Without a logger:");
const withoutLogger = new OrderService(loggerFor({ logging: false }));
withoutLogger.place(1);
withoutLogger.place(2);
console.log(`Placed ${withoutLogger.placed} orders`);
