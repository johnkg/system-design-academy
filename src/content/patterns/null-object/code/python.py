# Null Object in Python. A missing logger is a logger that does nothing.
from typing import Protocol


class Logger(Protocol):  # Abstract object
    def log(self, message: str) -> None: ...


class ConsoleLogger:  # Real object
    def log(self, message: str) -> None:
        print(f"[log] {message}")


class NullLogger:  # Null object: same interface, no behaviour
    def log(self, message: str) -> None:
        pass


class OrderService:  # Client: never checks whether the logger is real
    def __init__(self, logger: Logger) -> None:
        self.logger = logger
        self.placed = 0

    def place(self, order_id: int) -> None:
        self.placed += 1
        self.logger.log(f"placed order {order_id}")


def logger_for(logging: bool) -> Logger:  # the one place that decides what a missing logger means
    return ConsoleLogger() if logging else NullLogger()


print("With a logger:")
with_logger = OrderService(logger_for(True))
with_logger.place(1)
with_logger.place(2)
print(f"Placed {with_logger.placed} orders")

print("Without a logger:")
without_logger = OrderService(logger_for(False))
without_logger.place(1)
without_logger.place(2)
print(f"Placed {without_logger.placed} orders")
