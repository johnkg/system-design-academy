# Reactor in Python. One loop asks which connections are ready and dispatches each to its handler.
# The demultiplexer is simulated with fixed batches so that the output is the same on every run;
# real servers use select, epoll or kqueue (see the standard library's selectors module).
from __future__ import annotations

from typing import Callable


class Selector:  # Event demultiplexer: reports which sources are ready
    def __init__(self, batches: list[list[tuple[str, str]]]) -> None:
        self.batches = list(batches)

    def select(self) -> list[tuple[str, str]] | None:
        return self.batches.pop(0) if self.batches else None


class Reactor:
    def __init__(self, selector: Selector) -> None:
        self.selector = selector
        self._handlers: dict[str, Callable[[str], str]] = {}

    def register(self, connection: str, handler: Callable[[str], str]) -> None:
        self._handlers[connection] = handler

    @property
    def size(self) -> int:
        return len(self._handlers)

    def run(self) -> None:
        batch_number = 0
        while (ready := self.selector.select()) is not None:
            batch_number += 1
            print(f"batch {batch_number}: {len(ready)} ready")
            for connection, data in ready:  # dispatch: each handler is quick and does not block
                reply = self._handlers[connection](data)
                print(f'  {connection} got "{data}" -> "{reply}"')
        print("reactor: no more events, loop ends")


def shout(data: str) -> str:  # Event handlers
    return data.upper()


def greeter(data: str) -> str:
    return "goodbye" if data == "bye" else "hello"


selector = Selector([
    [("conn-2", "hello"), ("conn-1", "ping")],
    [("conn-3", "bye")],
])
reactor = Reactor(selector)
reactor.register("conn-1", shout)
reactor.register("conn-2", shout)
reactor.register("conn-3", greeter)
print(f"reactor: {reactor.size} connections registered")
reactor.run()
