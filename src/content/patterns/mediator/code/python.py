# Mediator in Python. Users talk only to the ChatRoom.
from __future__ import annotations


class ChatRoom:  # Concrete Mediator
    def __init__(self):
        self._users: dict[str, User] = {}

    def register(self, user: User) -> None:
        self._users[user.name] = user
        user.room = self

    def send(self, sender: User, message: str, to: str | None = None) -> None:
        if to:
            recipients = [self._users.get(to)]
        else:
            recipients = [u for u in self._users.values() if u is not sender]
        for user in recipients:
            if user is not None:
                user.receive(sender.name, message)


class User:  # Colleague
    def __init__(self, name: str):
        self.name = name
        self.room: ChatRoom | None = None

    def send(self, message: str, to: str | None = None) -> None:
        self.room.send(self, message, to)  # goes via the mediator

    def receive(self, sender: str, message: str) -> None:
        print(f'{self.name} got "{message}" from {sender}')


room = ChatRoom()
ada = User("Ada")
bob = User("Bob")
cy = User("Cy")
for u in (ada, bob, cy):
    room.register(u)

ada.send("Hi all")         # Bob and Cy receive it
bob.send("Hi Ada", "Ada")  # only Ada receives it
