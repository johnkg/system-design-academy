// Without the pattern: the logger may be null, so every use is guarded.

class OrderService {
  constructor(logger) { this.logger = logger; this.placed = 0; }

  place(id) {
    this.placed += 1;
    if (this.logger) this.logger.log(`placed order ${id}`); // check
  }

  cancel(id) {
    this.placed -= 1;
    this.logger.log(`cancelled order ${id}`); // someone forgot the check
  }
}

const logger = { log: (m) => console.log(`[log] ${m}`) };
const withLogger = new OrderService(logger);
withLogger.place(1);
withLogger.cancel(1);

const withoutLogger = new OrderService(null);
withoutLogger.place(1);
try {
  withoutLogger.cancel(1);
} catch {
  console.log("Crash: cancel() used a logger that was null");
}
