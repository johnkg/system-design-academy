# Observer in Python. Any object with an update() method is an observer.
from __future__ import annotations

from typing import Callable, Protocol


class Observer(Protocol):
    def update(self, headline: str) -> None: ...


class NewsChannel:  # Subject
    def __init__(self):
        self._subscribers: dict[Observer, None] = {}  # dict keeps insertion order

    def subscribe(self, observer: Observer) -> Callable[[], None]:
        self._subscribers[observer] = None
        return lambda: self._subscribers.pop(observer, None)  # call to unsubscribe

    def publish(self, headline: str) -> None:
        for observer in list(self._subscribers):
            observer.update(headline)


class EmailSubscriber:  # Concrete Observer
    def __init__(self, address: str):
        self.address = address

    def update(self, headline: str) -> None:
        print(f"Email to {self.address}: {headline}")


class SmsSubscriber:  # Concrete Observer
    def __init__(self, number: str):
        self.number = number

    def update(self, headline: str) -> None:
        print(f"SMS to {self.number}: {headline}")


channel = NewsChannel()
unsubscribe_email = channel.subscribe(EmailSubscriber("ada@example.com"))
channel.subscribe(SmsSubscriber("+1-555-0100"))

channel.publish("Pattern of the day: Observer")  # both are notified
unsubscribe_email()
channel.publish("Second headline")               # only SMS is notified
