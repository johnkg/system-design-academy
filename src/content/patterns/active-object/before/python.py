# Without the pattern: callers run the method themselves, and each one waits for it to finish.
import threading


class Calculator:
    def __init__(self):
        self._history = []
        self._lock = threading.Lock()  # needed as soon as two threads call add()

    def add(self, a, b):
        with self._lock:  # every caller waits here for its turn
            result = a + b
            self._history.append(result)
            return result

    def history(self):
        with self._lock:
            return ", ".join(str(r) for r in self._history)


calculator = Calculator()
print(f"add(2, 3) = {calculator.add(2, 3)}")
print(f"add(10, 5) = {calculator.add(10, 5)}")
print(f"history() = {calculator.history()}")
