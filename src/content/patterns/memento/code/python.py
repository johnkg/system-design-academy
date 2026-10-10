# Memento in Python. The player makes and restores snapshots; the manager only stores them.
from __future__ import annotations

from types import MappingProxyType


class Snapshot:  # Memento: immutable and opaque to everyone but Player
    __slots__ = ("_state",)

    def __init__(self, state: dict):
        object.__setattr__(self, "_state", MappingProxyType(dict(state)))

    def __setattr__(self, name, value):
        raise AttributeError("Snapshot is immutable")

    @staticmethod
    def read(snapshot: Snapshot):  # only Player's code path uses this
        return snapshot._state


class Player:  # Originator
    def __init__(self):
        self._hp = 100
        self._level = 1

    def take_damage(self, amount: int) -> None:
        self._hp = max(0, self._hp - amount)

    def level_up(self) -> None:
        self._level += 1

    def describe(self) -> str:
        return f"HP {self._hp}, level {self._level}"

    def save(self) -> Snapshot:
        return Snapshot({"hp": self._hp, "level": self._level})

    def restore(self, snapshot: Snapshot) -> None:
        state = Snapshot.read(snapshot)
        self._hp = state["hp"]
        self._level = state["level"]


class CheckpointManager:  # Caretaker: stores, never inspects
    def __init__(self):
        self._stack: list[Snapshot] = []

    def save(self, player: Player) -> None:
        self._stack.append(player.save())

    def load_last(self, player: Player) -> None:
        if self._stack:
            player.restore(self._stack.pop())


player = Player()
checkpoints = CheckpointManager()

checkpoints.save(player)  # HP 100, level 1
player.take_damage(70)
player.level_up()
print(player.describe())  # HP 30, level 2
checkpoints.load_last(player)
print(player.describe())  # HP 100, level 1
