# Active Object in Python. Calls become queued requests, run one at a time by a single worker thread.
import queue
import threading
from concurrent.futures import Future
from typing import Callable, Optional


class Calculator:  # Servant: a plain class, only ever called by the worker thread
    def __init__(self) -> None:
        self._history: list[int] = []

    def add(self, a: int, b: int) -> int:
        result = a + b
        self._history.append(result)
        return result

    def history(self) -> str:
        return ", ".join(str(r) for r in self._history)


class ActiveCalculator:  # Proxy and scheduler: callers get a future straight away
    def __init__(self, servant: Calculator) -> None:
        self._servant = servant
        self._queue: "queue.Queue[Optional[tuple[Callable, Future]]]" = queue.Queue()
        self.ran = 0
        self._worker = threading.Thread(target=self._run)
        self._worker.start()

    def add(self, a: int, b: int) -> Future:
        return self._enqueue(lambda: self._servant.add(a, b))

    def history(self) -> Future:
        return self._enqueue(self._servant.history)

    def _enqueue(self, call: Callable) -> Future:
        future: Future = Future()
        self._queue.put((call, future))
        return future

    def _run(self) -> None:  # one request at a time, in the order they were submitted
        while True:
            request = self._queue.get()
            if request is None:
                return
            call, future = request
            try:
                future.set_result(call())
            except Exception as error:
                future.set_exception(error)
            self.ran += 1

    def stop(self) -> None:
        self._queue.put(None)
        self._worker.join()


calculator = ActiveCalculator(Calculator())

first = calculator.add(2, 3)
print("submitted add(2, 3)")
second = calculator.add(10, 5)
print("submitted add(10, 5)")
history = calculator.history()
print("submitted history()")

print(f"add(2, 3) = {first.result()}")
print(f"add(10, 5) = {second.result()}")
print(f"history() = {history.result()}")
calculator.stop()
print(f"Servant ran {calculator.ran} requests on one worker")
