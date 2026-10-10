# Prototype in Python. clone() makes a deep-enough copy so clones stay independent.
from __future__ import annotations


class Enemy:  # Concrete Prototype
    def __init__(self, name: str, hp: int, items: list[str] | None = None):
        self.name = name
        self.hp = hp
        self.items = items if items is not None else []

    def clone(self) -> Enemy:
        return Enemy(self.name, self.hp, list(self.items))  # copy the list, do not share it


class Spawner:  # Client with a registry of prototypes
    def __init__(self):
        self._registry: dict[str, Enemy] = {}

    def register(self, key: str, prototype: Enemy) -> None:
        self._registry[key] = prototype

    def spawn(self, key: str) -> Enemy:
        return self._registry[key].clone()


def js_list(items: list[str]) -> str:  # format like Node's console.log of an array
    return "[ " + ", ".join(f"'{i}'" for i in items) + " ]"


spawner = Spawner()
spawner.register("goblin", Enemy("Goblin", 30, ["club"]))

a = spawner.spawn("goblin")
b = spawner.spawn("goblin")
a.items.append("shield")

print(js_list(a.items))  # [ 'club', 'shield' ]
print(js_list(b.items))  # [ 'club' ]: unaffected, thanks to the deep copy
