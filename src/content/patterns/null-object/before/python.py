# Without the pattern: the logger may be None, so every use is guarded.

class OrderService:
    def __init__(self, logger):
        self.logger = logger
        self.placed = 0

    def place(self, order_id):
        self.placed += 1
        if self.logger:  # check
            self.logger.log(f"placed order {order_id}")

    def cancel(self, order_id):
        self.placed -= 1
        self.logger.log(f"cancelled order {order_id}")  # someone forgot the check


class ConsoleLogger:
    def log(self, message):
        print(f"[log] {message}")


with_logger = OrderService(ConsoleLogger())
with_logger.place(1)
with_logger.cancel(1)

without_logger = OrderService(None)
without_logger.place(1)
try:
    without_logger.cancel(1)
except AttributeError:
    print("Crash: cancel() used a logger that was None")
