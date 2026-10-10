// A structured logger in JavaScript: JSON events, a correlation id on every line, and redaction of secrets.

const SENSITIVE = new Set(["password", "card_number", "token"]);

let tick = 0; // one shared clock, so timestamps increase across all loggers

class Logger {
  constructor(service, base = {}) { this.service = service; this.base = base; }

  // A child logger carries extra fields, such as the request id, on every line it writes
  child(fields) {
    return new Logger(this.service, { ...this.base, ...fields });
  }

  log(level, event, fields = {}) {
    const record = { ts: `T+${String(++tick).padStart(2, "0")}`, level, service: this.service, event, ...this.base };
    for (const [key, value] of Object.entries(fields)) record[key] = SENSITIVE.has(key) ? "[redacted]" : value;
    console.log(JSON.stringify(record));
  }
}

const gateway = new Logger("gateway").child({ request_id: "req-8f3a" });
gateway.log("info", "request_received", { user_id: 42, path: "/pay" });

const payments = new Logger("payments").child({ request_id: "req-8f3a" }); // the id arrived in a header
payments.log("error", "payment_failed", { user_id: 42, reason: "card_declined", card_number: "4111111111111111" });

// A different request, with its own id
new Logger("gateway").child({ request_id: "req-77c1" }).log("info", "request_received", { user_id: 7, path: "/pay" });
