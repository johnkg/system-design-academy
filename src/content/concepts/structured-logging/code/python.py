"""A structured logger in Python: JSON events, a correlation id on every line, and redaction of secrets."""
import json

SENSITIVE = {"password", "card_number", "token"}

tick = 0  # one shared clock, so timestamps increase across all loggers


class Logger:
    def __init__(self, service, base=None):
        self.service = service
        self.base = base or {}

    # A child logger carries extra fields, such as the request id, on every line it writes
    def child(self, **fields):
        return Logger(self.service, {**self.base, **fields})

    def log(self, level, event, **fields):
        global tick
        tick += 1
        record = {"ts": f"T+{tick:02d}", "level": level, "service": self.service, "event": event, **self.base}
        for key, value in fields.items():
            record[key] = "[redacted]" if key in SENSITIVE else value
        print(json.dumps(record, separators=(",", ":")))


gateway = Logger("gateway").child(request_id="req-8f3a")
gateway.log("info", "request_received", user_id=42, path="/pay")

payments = Logger("payments").child(request_id="req-8f3a")  # the id arrived in a header
payments.log("error", "payment_failed", user_id=42, reason="card_declined", card_number="4111111111111111")

# A different request, with its own id
Logger("gateway").child(request_id="req-77c1").log("info", "request_received", user_id=7, path="/pay")
